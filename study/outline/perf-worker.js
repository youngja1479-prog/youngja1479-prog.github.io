/* Same envelope/schema as the page; CPU-heavy JSON/base64 stays off its UI thread. */
const PBKDF2_ITERS = 150000;
function bufToB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return btoa(s);
}

function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function deriveAesKey(password, saltU8) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltU8, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(dataObj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const plain = new TextEncoder().encode(JSON.stringify(dataObj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    v: 1,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ct: bufToB64(ct),
    updatedAt: dataObj.updatedAt || Date.now()
  };
}
async function decryptEnvelope(env, password) {
  const salt = b64ToBuf(env.salt);
  const iv = b64ToBuf(env.iv);
  const ct = b64ToBuf(env.ct);
  const key = await deriveAesKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

self.onmessage = async ({ data: task }) => {
  try {
    let result;
    if (task.kind === 'fallback') result = JSON.stringify(task.payload, (k, v) =>
      (k === 'src' && typeof v === 'string' && v.startsWith('data:')) ? undefined : v);
    else if (task.kind === 'encrypt') result = await encryptData(task.payload, task.password);
    else if (task.kind === 'decrypt') result = await decryptEnvelope(task.payload, task.password);
    else throw new Error('Unknown performance task');
    self.postMessage({ id: task.id, result });
  } catch (err) {
    self.postMessage({ id: task.id, error: { name: err.name, message: err.message } });
  }
};
