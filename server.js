import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//  rutas 
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const TZ = 'America/Lima';

// Lee .env sin instalar una dependencia adicional.
loadEnv(); 
const PORT = Number(process.env.PORT || 3000);
// catálogo de doctores, especialidades y citas disponibles 
const DATASET = JSON.parse(await fs.readFile(path.join(DATA, 'datos.json'), 'utf8'));
await fs.mkdir(path.join(DATA, 'citas'), { recursive: true });
await fs.mkdir(path.join(DATA, 'conversaciones'), { recursive: true });

// Carga secretos/configuración local; .env está excluido por .gitignore.
function loadEnv() {
  try {
    const raw = readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const row of raw.split(/\r?\n/)) {
      const match = row.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

//Herramientas: En este caso solo 2, consultar_medicos y agendar_cita
const tools = [
  { type: 'function', name: 'consultar_medicos', description: 'Consulta médicos y turnos disponibles del área indicada. Úsala antes de ofrecer opciones de médicos o turnos.', strict: true,
    parameters: { type: 'object', properties: { area: { type: 'string', enum: DATASET.areas.map(x => x.nombre) } }, required: ['area'], additionalProperties: false } },
  { type: 'function', name: 'agendar_cita', description: 'Registra la cita cuando el paciente haya elegido médico y turno y haya dado su nombre completo.', strict: true,
    parameters: { type: 'object', properties: { nombre_medico: { type: 'string' }, turno: { type: 'string' }, nombre: { type: 'string' } }, required: ['nombre_medico', 'turno', 'nombre'], additionalProperties: false } }
];
// Reglas de seguridad y conversación que acompañan cada petición a la API.
const instructions = `Eres el asistente amable de Novaly para gestionar citas médicas. 
Habla en español claro, natural y breve. 
Tu tarea es orientar al paciente al área adecuada y ayudarle a agendar una cita médica.
Nunca diagnostiques ni recomiendes medicamentos o tratamientos, pero si puedes recomendar las áreas de especialidad que consideres, pero primero le preguntarás al usuario que especialidad desea.
Si no sabe que área de especialidad elegir, les harás una lista de las especialidades disponibles.
Si piden consejos médicos, explícale que no puedes darlos y ofrece ayudar a buscar una cita. 
Si parece una emergencia, recomienda buscar atención de emergencia local.
Usa el historial para conservar el contexto y no repetir preguntas. Pregunta solo por la información que falta; no asumas un área. Usa consultar_medicos antes de ofrecer médicos o turnos, y menciona solo los resultados que devuelva. 
Permite cambiar de médico o turno.
No te confundas,ni vuelvas a preguntar lo mismo, ni generes redundancia si es que un doctor tiene el mismo nombre que el paciente.
Llama agendar_cita solo cuando el paciente haya elegido un médico y turno y haya dado su nombre completo.
 No confirmes la cita hasta que la herramienta responda success=true.`;


 //Consultar por los doctores disponibles 
async function consultDoctors({ area }) {
  // Acepta el área solo si existe en el JSON y devuelve sus médicos con los turnos reales.
  const normalized = normalize(area);
  const validArea = DATASET.areas.find(item => normalize(item.nombre) === normalized);
  if (!validArea) return { success: false, mensaje: 'Área no encontrada.' };
  return { success: true, area: validArea.nombre, medicos: DATASET.medicos.filter(m => m.area === validArea.nombre).map(({ id, nombre, turnos }) => ({ id, nombre, turnos })) };
}

//Reservar cita
async function bookAppointment({ nombre_medico, turno, nombre }) {
  const patientName = String(nombre || '').trim().replace(/\s+/g, ' ');
  const doctorName = String(nombre_medico || '').trim();
  const selectedTurn = String(turno || '').trim();
  if (patientName.split(' ').filter(Boolean).length < 2) return { success: false, mensaje: 'Necesito el nombre y apellido del paciente.' };
  const doctor = DATASET.medicos.find(item => normalize(item.nombre) === normalize(doctorName));
  if (!doctor || !doctor.turnos.some(item => normalize(item) === normalize(selectedTurn))) return { success: false, mensaje: 'El médico o turno no está disponible. Consulta los turnos antes de agendar.' };
  const date = nextDateForTurn(selectedTurn);
  const citasDir = path.join(DATA, 'citas');
  const files = await fs.readdir(citasDir);
  for (const file of files.filter(name => name.endsWith('.json'))) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(citasDir, file), 'utf8'));
      if (saved.nombre_medico === doctor.nombre && saved.fecha === date && normalize(saved.turno) === normalize(selectedTurn)) {
        return { success: false, mensaje: 'Ese turno acaba de ocuparse. Elige otro de los turnos disponibles.' };
      }
    } catch { /* Ignore malformed demo files. */ }
  }
  const time = selectedTurn.match(/(\d{2}):(\d{2})/)?.[0];
  if (!time) return { success: false, mensaje: 'El turno tiene un formato inválido.' };
  const filename = `cita_${date}_${time.replace(':', '-')}.json`;
  const appointment = {
  nombre: patientName,
  nombre_medico: doctor.nombre,
  correo_medico: doctor.correo || null,
  turno: selectedTurn,
  fecha: date,
  creado_en: new Date().toISOString()
};

  // Mantener en archivos separados las citas con la misma hora pero con médicos diferentes.
  let target = path.join(citasDir, filename);
  try { await fs.access(target); target = path.join(citasDir, `cita_${date}_${time.replace(':', '-')}_${doctor.id}.json`); } catch {}
  await fs.writeFile(target, JSON.stringify(appointment, null, 2), 'utf8');
  return { success: true, mensaje: 'Cita registrada correctamente', cita: appointment };
}

function normalize(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function limaWeekday(date = new Date()) { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(date); }
function nextDateForTurn(turn) {
  
  // El JSON trae día de semana y hora, no una fecha; se calcula la próxima ocurrencia en Lima.
  const weekdayNames = { lunes: 'Monday', martes: 'Tuesday', miercoles: 'Wednesday', jueves: 'Thursday', viernes: 'Friday', sabado: 'Saturday', domingo: 'Sunday' };
  const wanted = weekdayNames[normalize(turn).split(' ')[0]];
  if (!wanted) throw new Error('Día no válido en el turno.');
  const current = new Date();
  const todayInLima = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(current);
  const [year, month, day] = todayInLima.split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const weekdayIndex = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  let days = (weekdayIndex[wanted] - today.getUTCDay() + 7) % 7;
  const slot = turn.match(/(\d{2}):(\d{2})/);
  if (days === 0 && slot) {
    const limaTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(current);
    const [hour, minute] = limaTime.split(':').map(Number);
    if (hour * 60 + minute >= Number(slot[1]) * 60 + Number(slot[2])) days = 7;
  }
  today.setUTCDate(today.getUTCDate() + days);
  return today.toISOString().slice(0, 10);
}

async function localReply(session, latest) {
  const text = normalize(latest);
  if (/no puedo respirar|me falta el aire|dolor fuerte en el pecho|perdi el conocimiento|sangrado abundante/.test(text)) {
    return 'Lamento que estés pasando por esto. No puedo evaluar síntomas; busca atención de emergencia local ahora.';
  }
  if (/que (puedo|debo) tomar|que medicamento|recomiend.*tratamiento|diagnostic/.test(text)) {
    return 'No puedo indicar medicamentos, tratamientos ni diagnósticos. Si quieres, puedo ayudarte a encontrar un médico para que evalúe tu caso.';
  }
  const state = session.state ||= {};
  Object.assign(state, {
    area: state.area ?? null, medico: state.medico ?? null, turno: state.turno ?? null,
    nombre: state.nombre ?? null, doctorsShown: state.doctorsShown ?? false, turnsShown: state.turnsShown ?? false
  });
  if (/empezar de nuevo|reiniciar|otra cita|nueva cita/.test(text)) {
    Object.assign(state, { area: null, medico: null, turno: null, nombre: null, doctorsShown: false, turnsShown: false, citaRegistrada: false, pendingTurn: null });
    if (/otra cita|nueva cita/.test(text)) return 'Claro, empezamos otra cita. ¿Qué tipo de consulta necesitas?';
  }

  const detectedArea = DATASET.areas.find(item => text.includes(normalize(item.nombre)) ||
    (item.nombre === 'Traumatología' && /rodilla|espalda|hueso|fractura|lesion|articulacion|musculo|golpe/.test(text)) ||
    (item.nombre === 'Cardiología' && /corazon|palpitacion|presion|pecho/.test(text)) ||
    (item.nombre === 'Dermatología' && /piel|mancha|sarpullido|acne|picazon|lunar/.test(text)));
  if (detectedArea && detectedArea.nombre !== state.area) {
    Object.assign(state, { area: detectedArea.nombre, medico: null, turno: null, doctorsShown: false, turnsShown: false });
  }

  const selectedDoctor = DATASET.medicos.find(m => {
    const firstName = normalize(m.nombre).split(' ')[0];
    return text.includes(normalize(m.nombre)) || (firstName.length > 2 && new RegExp(`\\b${firstName}\\b`).test(text));
  });
  if (selectedDoctor && selectedDoctor.nombre !== state.medico) {
    state.area = selectedDoctor.area; state.medico = selectedDoctor.nombre; state.turno = null;
    state.doctorsShown = true; state.turnsShown = false;
  }
  if (/otro medico|cambiar de medico|prefiero otro/.test(text)) {
    state.medico = null; state.turno = null; state.doctorsShown = false; state.turnsShown = false;
  }
  if (/otro turno|cambiar (el )?turno|prefiero otro horario/.test(text)) {
    state.turno = null; state.turnsShown = false;
  }

  const findTurn = (doctor, phrase) => doctor?.turnos.find(turn => {
    const [day, time] = normalize(turn).split(' ');
    if (normalize(phrase).includes(normalize(turn))) return true;
    const hour = normalize(phrase).match(/\b(?:a\s+las?\s*)?(\d{1,2})(?::(\d{2}))?\b/);
    return normalize(phrase).includes(day) && hour && Number(hour[1]) === Number(time.slice(0, 2)) && (!hour[2] || hour[2] === time.slice(3));
  });
  const doctor = DATASET.medicos.find(m => m.nombre === state.medico);
  if (doctor && !state.turno) state.turno = findTurn(doctor, latest) || (state.pendingTurn && findTurn(doctor, state.pendingTurn)) || null;
  else if (!doctor && /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(text) && /\b\d{1,2}(?::\d{2})?\b/.test(text)) state.pendingTurn = latest;

  const named = latest.match(/(?:me llamo|mi nombre es|soy)\s+([a-záéíóúñ]+(?:\s+(?!y\b|para\b|el\b|la\b|con\b|a\b|turno\b)[a-záéíóúñ]+){1,3})/i);
  if (named) state.nombre = named[1].trim();
  else if (state.medico && state.turno && !state.nombre && /^[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){1,3}[.!]?$/i.test(latest.trim())) state.nombre = latest.trim().replace(/[.!]+$/, '');

  if (!state.area) return 'Con gusto te ayudo. ¿Qué tipo de consulta o molestia deseas atender?';
  const areaDoctors = DATASET.medicos.filter(m => m.area === state.area);
  if (!state.medico) {
    if (!state.doctorsShown) {
      state.doctorsShown = true;
      return `Puedo orientarte a ${state.area}. Médicos disponibles:\n${areaDoctors.map(m => `• ${m.nombre}`).join('\n')}\n¿Cuál prefieres?`;
    }
    return `Seguimos con ${state.area}. ¿Con cuál médico prefieres atenderte: ${areaDoctors.map(m => m.nombre).join(' o ')}?`;
  }
  if (!state.turno) {
    if (!state.turnsShown) {
      state.turnsShown = true;
      return `${state.medico} tiene estos turnos:\n${doctor.turnos.map(t => `• ${t}`).join('\n')}\n¿Cuál te conviene?`;
    }
    return `¿Qué turno de ${state.medico} prefieres? Por ejemplo: "${doctor.turnos[0]}".`;
  }
  if (!state.nombre) return `Tengo seleccionado ${state.medico}, ${state.turno}. ¿Me indicas tu nombre y apellido para registrar la cita?`;
  if (state.citaRegistrada) return `La cita de ${state.nombre} ya quedó registrada. Si deseas otra, dime “nueva cita”.`;

  const result = await bookAppointment({ nombre: state.nombre, nombre_medico: state.medico, turno: state.turno });
  if (!result.success) {
    state.turno = null; state.turnsShown = false;
    return `${result.mensaje} Elige otro turno y conservaremos el médico y tu nombre.`;
  }
state.citaRegistrada = true;
const email = result.cita?.correo_medico;
const contacto = email
  ? ` Si necesitas comunicarte con el médico o cambiar tu cita, puedes escribirle a ${email}.`
  : ' El correo del médico no está registrado.';
return `Gracias, ${state.nombre}. Registré tu cita para ${state.turno} con ${state.medico}.${contacto}`;
}

async function openAIReply(session) {
  // Se envían solo los últimos 16 mensajes para limitar tokens y conservar contexto reciente.
  const history = session.messages.slice(-16).map(({ role, content }) => ({ role, content }));
  let input = history;
  let response;
  for (let pass = 0; pass < 5; pass++) {
    // El servidor conserva la API key y la conversación no se guarda en OpenAI.
    const result = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions,
        input, tools, parallel_tool_calls: false, store: false, max_output_tokens: 350
      })
    });
    if (!result.ok) {
      const detail = await result.json().catch(() => ({}));
      throw new Error(detail.error?.message || `OpenAI respondió con estado ${result.status}.`);
    }
    response = await result.json();
    // El modelo puede pedir una herramienta; el servidor la ejecuta y devuelve su resultado.
    const calls = (response.output || []).filter(item => item.type === 'function_call');
    if (!calls.length) break;
    input = [...input, ...response.output];
    for (const call of calls) {
      let output;
      try {
        const args = JSON.parse(call.arguments || '{}');
        if (call.name === 'consultar_medicos') output = await consultDoctors(args);
        else if (call.name === 'agendar_cita') {
          output = await bookAppointment(args);
          if (output.success) {
            session.state.nombre = args.nombre;
            session.state.citaRegistrada = true;
          }
        }
        else output = { success: false, mensaje: 'Herramienta desconocida.' };
      } catch { output = { success: false, mensaje: 'No pude procesar los datos. Verifica la selección y vuelve a intentar.' }; }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
    }
  }
  const message = (response?.output || []).find(item => item.type === 'message');
  const text = message?.content?.filter(part => part.type === 'output_text').map(part => part.text).join('\n').trim();
  return text || 'No pude generar una respuesta. ¿Podrías repetirlo?';
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw new Error('Mensaje demasiado extenso.'); }
  return JSON.parse(raw || '{}');
}
async function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      // Punto de entrada del chat: valida, carga historial, genera respuesta y persiste la sesión.
      const body = await readBody(req);
      const sessionId = String(body.sessionId || '');
      const message = String(body.message || '').trim();
      if (!/^[\w-]{20,50}$/.test(sessionId)) return sendJson(res, 400, { error: 'Sesión inválida. Reinicia la conversación.' });
      if (!message || message.length > 1200) return sendJson(res, 400, { error: 'Escribe un mensaje de hasta 1200 caracteres.' });
      const file = path.join(DATA, 'conversaciones', `${sessionId}.json`);
      let session = { id: sessionId, messages: [], state: {} };
      try { session = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
      session.messages ||= []; session.state ||= {};
      session.messages.push({ role: 'user', content: message, at: new Date().toISOString() });
      const mode = process.env.OPENAI_API_KEY ? 'ai' : 'local';
      let reply;
      try { reply = mode === 'ai' ? await openAIReply(session) : await localReply(session, message); }
      catch (error) {
        console.error('Error de chat:', error.message);
        session.messages.pop();
        await sendJson(res, 502, { error: 'El servicio de IA no respondió. Revisa la conexión o la configuración de la API key y vuelve a intentar.' });
        return;
      }
      session.messages.push({ role: 'assistant', content: reply, at: new Date().toISOString() });
      session.updated_at = new Date().toISOString();
      await fs.writeFile(file, JSON.stringify(session, null, 2), 'utf8');
      return sendJson(res, 200, { reply, mode });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, mode: process.env.OPENAI_API_KEY ? 'ai' : 'local' });
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido.' });
    const relative = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    // Sirve la interfaz y evita que una ruta pueda leer archivos fuera de /public.
    const target = path.resolve(PUBLIC, relative);
    if (!target.startsWith(`${PUBLIC}${path.sep}`)) return sendJson(res, 403, { error: 'Acceso denegado.' });
    const contents = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(contents);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Ocurrió un error inesperado.' });
  }
});
server.listen(PORT, () => console.log(`Novaly listo en http://localhost:${PORT} (${process.env.OPENAI_API_KEY ? 'IA activa' : 'modo local'})`));


