// Atajo para buscar elementos de la página por su selector CSS.
const $ = (s) => document.querySelector(s);
const messages = $('#messages');
const form = $('#chat-form');
const input = $('#message-input');

// El navegador conserva un ID para que el servidor recupere la misma conversación.
let sessionId = localStorage.getItem('novaly-session') || crypto.randomUUID();
localStorage.setItem('novaly-session', sessionId);

function bubble(role, text) {
  const item = document.createElement('div');
  item.className = `bubble ${role}`;
  item.textContent = text;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}
bubble('assistant', '¡Hola! Soy el asistente de Novaly Medic. Puedo ayudarte a encontrar un médico y agendar una cita. ¿Qué consulta necesitas?');
fetch('/api/health')
  .then(response => response.json())
  .then(info => { $('#mode').textContent = info.mode === 'local' ? 'Modo local · sin IA' : 'IA activa · herramienta del servidor'; })
  .catch(() => { $('#mode').textContent = 'Servidor no disponible'; });


  //Toma el mensaje del usuario 
  // lo envía a tu backend /api/chat 
  // recibe la respuesta 
  // la muestra en el chat.
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  bubble('user', text);
  input.value = '';
  input.disabled = true;
  $('#send').disabled = true;
  const waiting = document.createElement('div');
  waiting.className = 'bubble assistant waiting';
  waiting.textContent = 'Un momento…';
  messages.append(waiting);
  messages.scrollTop = messages.scrollHeight;
  try {
    // El navegador solo envía el mensaje y el ID; la API key nunca llega al cliente.
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No se pudo procesar el mensaje.');
    waiting.remove();
    bubble('assistant', payload.reply);
    $('#mode').textContent = payload.mode === 'local' ? 'Modo local · sin IA' : 'IA activa · herramienta del servidor';
  } catch (error) {
    waiting.remove();
    bubble('assistant', `No pude procesar el mensaje. ${error.message}`);
  } finally {
    input.disabled = false;
    $('#send').disabled = false;
    input.focus();
  }
});

$('#reset').addEventListener('click', async () => {
  sessionId = crypto.randomUUID();
  localStorage.setItem('novaly-session', sessionId);
  messages.replaceChildren();
  bubble('assistant', 'Conversación reiniciada. ¿Qué consulta necesitas?');
});

