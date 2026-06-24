const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scripts = ['data','audio','entities','dungeon','combat','items','tavern','arena','render','ui','save','treasury'];
const jsDir = fs.existsSync('js') ? 'js' : '.';
let game = '';
for (const s of scripts) game += fs.readFileSync(path.join(jsDir, s + '.js'), 'utf8') + '\n;\n';

// Override DOM-heavy renderers so logic tests don't need the full index.html tree.
const overrides = `
  updateUI = function(){};
  renderArenaPanel = function(){};
  renderBestFloor = function(){};
  renderMessages = function(){};
  renderEnemyIntents = function(){};
  addMessage = function(){};
  showEventCard = function(){};
  addFloatingText = function(){};
  addBurst = function(){};
  triggerHitStop = function(){};
  triggerScreenFlash = function(){};
  spawnDeathAnim = function(){};
  sfxBossEncounter = function(){};
  sfxLevelUp = function(){};
  sfxDeath = function(){};
  sfxItemPickup = function(){};
  trackGoldPickup = function(){};
`;
const html = fs.readFileSync('tests.html', 'utf8');
const inline = html.split('<script>').pop().split('</script>')[0];
const bundle = game + '\n;\n' + overrides + '\n;\n' + inline;

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <canvas id="game-canvas" width="1000" height="720"></canvas>
  <div id="game-ui"></div><div id="game-over"></div><div id="class-select"></div><div id="title-screen"></div><div id="summary"></div><div id="results"></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
window.Image = class { set src(_) {} };
window.requestAnimationFrame = () => 0;
const aStub = { createOscillator:()=>({connect(){},start(){},stop(){},frequency:{setValueAtTime(){},value:0},type:''}), createGain:()=>({connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},value:0}}), destination:{}, currentTime:0 };
window.AudioContext = window.webkitAudioContext = class { constructor(){ Object.assign(this, aStub);} };

try { vm.runInContext(bundle, dom.getInternalVMContext(), { filename:'bundle.js' }); }
catch (e) { console.log('BUNDLE ERROR:', e.message,'\n',(e.stack||'').split('\n').slice(0,5).join('\n')); }

const summary = window.document.getElementById('summary').textContent;
const cases = [...window.document.querySelectorAll('.case')].map(c => ({
  ok: c.className.includes('ok'),
  name: c.querySelector('.name')?.textContent || '',
  detail: c.querySelector('.detail')?.textContent || ''
}));
console.log('\n=== TEST RESULTS ===');
cases.forEach(c => console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? '\n      → ' + c.detail.replace(/\n/g,'\n      ') : ''}`));
console.log('\n' + (summary || '(no summary)'));
process.exit((summary && !summary.includes('FAILURES')) ? 0 : 1);
