from pathlib import Path
import argparse, json, math
from playwright.sync_api import sync_playwright, Page, expect

from embedded_texture import fixture

OUT=Path('/tmp/ruzgar-lab-browser-checks')
OUT.mkdir(exist_ok=True)
RECEIPTS: list[str]=[]

def passed(name: str) -> None:
 RECEIPTS.append(name)
 print('PASS',name,flush=True)

def number(page: Page, selector: str) -> float:
 return float(page.locator(selector).inner_text().replace('.','').replace(',','.'))

def responsive(page: Page, name: str) -> None:
 for width in [320,390,768,1440]:
  page.set_viewport_size({'width':width,'height':900})
  page.evaluate('window.scrollTo(0,0)')
  measure=page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
  assert measure['scroll'] <= width, (name,measure)
  page.screenshot(path=str(OUT/f'{name}-{width}.png'),full_page=True)
 passed(f'{name}: 320/390/768/1440 px without document overflow')

def wind(page: Page, base: str) -> None:
 errors: list[str]=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 page.goto(base+'/ruzgar-lab/',wait_until='networkidle')
 expect(page.locator('#flow-status')).to_have_attribute('data-state','ready',timeout=30000)
 assert float(page.locator('#flow-status').get_attribute('data-residual')) < 1e-5
 responsive(page,'ruzgar')
 page.locator('[data-model="sphere"]').click()
 before=number(page,'#drag')
 page.locator('#speed').fill('40');page.locator('#speed').blur()
 page.wait_for_timeout(300)
 assert math.isclose(number(page,'#drag'),before*4,abs_tol=.5)
 page.locator('#speed').fill('0');page.locator('#speed').blur();page.wait_for_timeout(200)
 assert number(page,'#drag')==0 and number(page,'#lift')==0
 assert 'Rüzgâr yok' in page.locator('#live-badge').inner_text()
 page.locator('#speed').fill('');page.locator('#speed').blur();expect(page.locator('#speed')).to_have_value('0')
 passed('ruzgar: speed squared force, zero wind, blank-input recovery')
 page.locator('#reset').click()
 for model in page.locator('[data-model]').all():
  model.click()
  expect(page.locator('#flow-status')).to_have_attribute('data-state','ready',timeout=30000)
  assert float(page.locator('#flow-status').get_attribute('data-residual')) < 1e-5
  assert math.isfinite(number(page,'#drag'))
 passed('ruzgar: all six geometry-dependent flow calculations converge')
 # A stale calculation must not overwrite the most recent model/orientation.
 page.locator('[data-model="sphere"]').click()
 page.locator('[data-model="wing"]').click()
 page.locator('[data-model="cube"]').click()
 expect(page.locator('#flow-status')).to_have_attribute('data-state','ready',timeout=30000)
 expect(page.locator('#scene-title')).to_contain_text('Küp')
 page.locator('#scale').fill('5');page.locator('#scale').blur()
 page.locator('#tunnelWidth').evaluate('(el)=>{el.value="2";el.dispatchEvent(new Event("input",{bubbles:true}))}')
 expect(page.locator('#flow-status')).to_have_attribute('data-state','error',timeout=30000)
 expect(page.locator('#flow-status')).to_contain_text('sığmıyor')
 page.locator('#reset').click()
 expect(page.locator('#flow-status')).to_have_attribute('data-state','ready',timeout=30000)
 passed('ruzgar: obsolete solve cancellation, invalid geometry warning, recovery')
 page.locator('[data-model="wing"]').click()
 page.locator('#pitch').fill('15');page.locator('#pitch').blur();page.wait_for_timeout(150)
 assert page.locator('#drag').inner_text()=='—'
 expect(page.locator('#warnings')).to_contain_text('açı sınırı')
 page.locator('#pitch').fill('-6');page.locator('#pitch').blur();page.wait_for_timeout(150)
 assert number(page,'#lift')<0
 passed('ruzgar: all six models, wing angle boundary and negative lift')
 for mode in ['pressure','combined','flow']:
  page.locator(f'[data-display="{mode}"]').click()
  expect(page.locator(f'[data-display="{mode}"]')).to_have_attribute('aria-pressed','true')
 for view in ['side','top','front','perspective']:
  page.locator(f'[data-view="{view}"]').click()
  expect(page.locator(f'[data-view="{view}"]')).to_have_class('view-button active')
  if view == 'side':expect(page.locator('#flow-slice')).to_contain_text('XY')
  if view == 'top':expect(page.locator('#flow-slice')).to_contain_text('XZ')
 for layer in ['lines','particles','vectors','wireframe']:
  page.locator(f'[data-layer="{layer}"]').check()
  page.locator(f'[data-layer="{layer}"]').uncheck()
 page.locator('#play').click();expect(page.locator('#live-badge')).to_contain_text('Duraklatıldı')
 page.locator('#play').click();expect(page.locator('#live-badge')).to_contain_text('Akış açık')
 page.locator('#help').click();expect(page.get_by_role('dialog')).to_be_visible();page.keyboard.press('Escape')
 passed('ruzgar: display modes, layers, four camera views, pause, help')
 page.locator('#reset').click();page.locator('#record').click()
 page.locator('#speed').fill('40');page.locator('#speed').blur();page.wait_for_timeout(200);page.locator('#record').click()
 expect(page.locator('#run-count')).to_have_text('2')
 for selector,ext in [('#export','csv'),('#export-json','json'),('#screenshot','png')]:
  with page.expect_download() as info:page.locator(selector).click()
  download=info.value;path=OUT/f'wind-export.{ext}';download.save_as(str(path));assert path.stat().st_size>50
 runs=json.loads((OUT/'wind-export.json').read_text())['runs']
 assert math.isclose(runs[1]['results']['drag'],4*runs[0]['results']['drag'])
 passed('ruzgar: notebook snapshots and CSV/JSON/PNG export')
 page.locator('#file-input').set_input_files(str(fixture()))
 expect(page.locator('#scene-title')).to_contain_text('embedded-texture.gltf')
 expect(page.locator('#toast')).to_contain_text('Model yüklendi')
 page.wait_for_timeout(200)
 assert not errors, errors
 passed('ruzgar: embedded glTF texture loads without hidden console error')
 bad=json.loads(fixture().read_text());bad['images']=[{'uri':'missing-texture.png'}]
 badfile=OUT/'missing-texture.gltf';badfile.write_text(json.dumps(bad))
 page.locator('#file-input').set_input_files(str(badfile))
 expect(page.locator('#toast')).to_contain_text('Eksik model dosyası')
 expect(page.locator('#scene-title')).to_contain_text('embedded-texture.gltf')
 passed('ruzgar: missing texture reports failure and preserves previous model')



def main() -> None:
 parser=argparse.ArgumentParser()
 parser.add_argument('--base',default='http://127.0.0.1:3137',help='Origin serving /ruzgar-lab/')
 parser.add_argument('--chromium',default='/usr/bin/chromium')
 args=parser.parse_args()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  context=browser.new_context(viewport={'width':1440,'height':900})
  context.set_default_timeout(8000)
  try:wind(context.new_page(),args.base.rstrip('/'))
  finally:
   context.close()
   browser.close()
 (OUT/'receipts.json').write_text(json.dumps(RECEIPTS,ensure_ascii=False,indent=2))
 print(f'{len(RECEIPTS)} grouped checks passed')
if __name__=='__main__':main()
