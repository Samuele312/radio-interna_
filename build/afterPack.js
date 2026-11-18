// Dopo la creazione dell'app su Mac la si "firma" in modo semplice (ad-hoc), altrimenti sui Mac con chip Apple
// il sistema la considera danneggiata. Non sostituisce una firma Apple a pagamento: alla prima apertura serve
// comunque clic destro → Apri.
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  try { execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' }); }
  catch (e) { console.warn('Firma semplice non riuscita:', e.message); }
};
