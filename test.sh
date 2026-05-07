#!/bin/sh

echo "=== syntax check ==="

node --check index.js || exit 1
node --check scan.js || exit 1
node --check psa-report.js || exit 1
node --check api.js || exit 1
node --check lib/redis-cache.js || exit 1
node --check lib/swagger.js || exit 1

for f in \
  extension/background.js \
  extension/popup/popup.js \
  extension/dashboard/dashboard.js \
  extension/content/sites/discord.js \
  extension/content/sites/pokemon-center.js \
  extension/content/sites/pokemon-center-listings.js \
  extension/content/sites/pokemon-center-jp.js \
  extension/content/sites/walmart.js \
  extension/content/sites/costco.js \
  extension/content/queue-monitor.js; do
  node --check "$f" || { echo "FAIL: $f"; exit 1; }
done

node -e "
  const m=JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8'));
  if(m.manifest_version!==3){console.error('bad manifest version');process.exit(1)}
  const fs=require('fs');
  const files=new Set();
  m.content_scripts.forEach(cs=>cs.js.forEach(j=>files.add('extension/'+j)));
  files.add('extension/'+m.background.service_worker);
  for(const f of files){if(!fs.existsSync(f)){console.error('missing:',f);process.exit(1)}}
" || exit 1

# Validate cached scrape output
echo "=== output validation ==="
JSONS=$(ls output/*.json 2>/dev/null)
if [ -z "$JSONS" ]; then
  echo "SKIP: no cached output files"
else
  node -e "
    const fs = require('fs');
    const files = fs.readdirSync('output').filter(f => f.endsWith('.json') && !f.match(/-\d+\.json$/));
    let pass = 0, fail = 0;
    for (const f of files) {
      try {
        const d = JSON.parse(fs.readFileSync('output/' + f, 'utf8'));
        const r = d.results?.[0];
        if (!r) { console.log('SKIP:', f, '(no results)'); continue; }
        const items = r.activeByCountry?.US || [];
        const checks = [];
        if (items.length) checks.push('listings=' + items.length);
        if (items.every(i => i.imageUrl)) checks.push('images=ok');
        if (items.every(i => i.price > 0)) checks.push('prices=ok');
        if (items.every(i => i.condition)) checks.push('conditions=ok');
        const hasAdditional = items.some(i => i.additionalImages?.length > 0);
        if (hasAdditional) checks.push('additionalImages=ok');
        console.log('✓', f, checks.join(' '));
        pass++;
      } catch (e) {
        console.log('✗', f, e.message);
        fail++;
      }
    }
    console.log(pass + ' passed, ' + fail + ' failed');
    if (fail) process.exit(1);
  " || exit 1
fi

# Secrets scan
echo "=== secrets scan ==="
FOUND=$(grep -rlEn \
  'sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|xoxb-|xoxp-|-----BEGIN (RSA |EC )?PRIVATE KEY' \
  --include="*.js" --include="*.json" --include="*.html" --include="*.md" \
  . 2>/dev/null | grep -v node_modules | grep -v '.env.example')
if [ -n "$FOUND" ]; then
  echo "FAIL: possible secrets:"
  echo "$FOUND"
  exit 1
fi
echo "✓ no secrets found"

echo "=== all checks passed ==="
