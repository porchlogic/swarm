
// util.js — SHA-256 with reliable fallback (consistent with SubtleCrypto)
export async function sha256Hex(str) {
  if (window.crypto && window.crypto.subtle) {
    try {
      const enc = new TextEncoder();
      const data = enc.encode(str);
      const hash = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
    } catch (e) { /* fall through */ }
  }
  return sha256Hex_fallback(str);
}

// Correct pure-JS SHA-256 fallback (public domain style)
function sha256Hex_fallback(ascii) {
  function rrot(v, a) { return (v>>>a) | (v<<(32-a)); }
  const maxWord = Math.pow(2, 32);

  // Init constants
  const hash = [];
  const k = [];
  let primeCounter = 0, candidate = 2;
  while (primeCounter < 64) {
    let isPrime = true;
    for (let i=2;i*i<=candidate;i++) { if (candidate % i === 0) { isPrime = false; break; } }
    if (isPrime) {
      if (primeCounter < 8) hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1/3) * maxWord) | 0;
    }
    candidate++;
  }

  // Pre-processing
  const words = [];
  const asciiBitLength = ascii.length * 8;
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (let i=0;i<ascii.length;i++) {
    const j = ascii.charCodeAt(i);
    words[i>>2] = words[i>>2] || 0;
    words[i>>2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = (asciiBitLength) | 0;

  let [h0,h1,h2,h3,h4,h5,h6,h7] = hash;
  const w = new Array(64);

  for (let j=0;j<words.length; j+=16) {
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i=0;i<64;i++) {
      if (i<16) w[i] = words[j+i] | 0;
      else {
        const s0 = rrot(w[i-15],7) ^ rrot(w[i-15],18) ^ (w[i-15]>>>3);
        const s1 = rrot(w[i-2],17) ^ rrot(w[i-2],19) ^ (w[i-2]>>>10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
      }
      const ch = (e & f) ^ (~e & g);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const S0 = rrot(a,2) ^ rrot(a,13) ^ rrot(a,22);
      const S1 = rrot(e,6) ^ rrot(e,11) ^ rrot(e,25);
      const t1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e;
      e = (d + t1) | 0;
      d = c; c = b; b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const out = [h0,h1,h2,h3,h4,h5,h6,h7].map(x => ("00000000"+((x>>>0).toString(16))).slice(-8)).join("");
  return out;
}

export function nanoid(len = 12) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  const arr = new Uint8Array(len);
  if (window.crypto && window.crypto.getRandomValues) crypto.getRandomValues(arr);
  else { for (let i=0;i<len;i++) arr[i] = (Date.now()+i) & 0xff; }
  for (let i=0;i<len;i++) out += chars[arr[i] % chars.length];
  return out;
}

export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const nowMsPerf=()=>performance.now();
export function log(el,...args){
  console.log("[DEBUG]",...args);
  if(!el) return;
  const s=args.map(a=>(typeof a==="object"?JSON.stringify(a):String(a))).join(" ");
  el.textContent=(s+"\n")+el.textContent.slice(0,5000);
}
