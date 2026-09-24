// Carga los módulos no gráficos en Node para pruebas sin navegador
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('js/ui/'));
for (const s of scripts) require(path.join(root, s));
const L = globalThis.JLab;

async function makeLab() {
  const lab = new L.Lab();
  await lab.init();
  return lab;
}
// Ejecuta una línea y devuelve {out, code}
async function sh(shell, line) {
  const buf = new L.shio.BufferSink();
  const code = await shell.run(line, { stdin: new L.shio.NullSource(), stdout: buf, stderr: buf });
  return { out: buf.data, code };
}
module.exports = { L, makeLab, sh };
