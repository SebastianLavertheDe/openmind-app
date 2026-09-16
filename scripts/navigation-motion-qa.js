const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** Real AppShell, long conversation and virtualized document; no private data. */
exports.checkNavigationMotion = async ({ win, directory, js, cdp, measure, until, check, delay }) => {
  const click = "document.querySelector('.nav-collapse-button').click()";
  await js("window.motionSamples.probeNavigation=true");
  // Compare against the old immediate switch and a naive live-grid animation
  // in the same renderer and fixture before measuring the shipping behavior.
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (let i = 0; i < 2; i++) await measure(`navigation-immediate-baseline-${i}`, click);
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  await js(`window.navigationBaselineStyle=document.createElement('style');
    window.navigationBaselineStyle.textContent='.app-shell{transition:grid-template-columns 240ms cubic-bezier(.3,0,0,1)}';
    document.head.append(window.navigationBaselineStyle)`);
  for (let i = 0; i < 2; i++) await measure(`navigation-grid-baseline-${i}`, `${click};document.querySelector('.app-shell').removeAttribute('data-nav-transitioning')`);
  await js("window.navigationBaselineStyle.remove()");

  for (let i = 0; i < 4; i++) {
    const collapsed = await js("document.querySelector('.app-nav').classList.contains('collapsed')");
    const phase = await measure(`navigation-${collapsed ? "expand" : "collapse"}-${i}`, click);
    assert(phase.navigationAnimated, "Both navigation directions must have a visible animation");
    assert(phase.liveWorkspaceWidths.length > 2, "Content must resize continuously with navigation");
    check(`navigation ${i} p95 frame`, phase.p95Ms, 34);
    check(`navigation ${i} max frame`, phase.maxMs, 100);
    assert.equal(await js("document.querySelector('.app-nav').classList.contains('collapsed')"), !collapsed);
    assert.equal(await js("document.querySelector('.nav-collapse-button').getAttribute('aria-expanded')"), String(collapsed));
  }
  // Inspect halfway frames and ensure virtual document blocks remain in flow.
  for (let i = 0; i < 2; i++) {
    const direction = await js("document.querySelector('.app-nav').classList.contains('collapsed') ? 'expand' : 'collapse'");
    await js(click);
    await until("document.querySelector('.app-shell').getAnimations().some(a=>a.transitionProperty==='grid-template-columns')");
    const frame = await js(`(() => {
      document.querySelector('.app-shell').getAnimations().forEach(a=>{a.pause();a.currentTime=80});
      return {width:document.querySelector('.app-nav').getBoundingClientRect().width};
    })()`);
    const bounds = await js("({rail:parseFloat(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--layout-nav-rail-width')),expanded:parseFloat(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--layout-nav-expanded-width'))})");
    assert(frame.width > bounds.rail && frame.width < bounds.expanded, "Navigation must show an intermediate width");
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert(await js(`(() => {
      const rows=[...document.querySelectorAll('.ai-file-preview [data-document-block]')];
      return rows.every((row,index)=>!rows[index+1] || Number(rows[index+1].dataset.documentBlock)!==Number(row.dataset.documentBlock)+1
        || row.getBoundingClientRect().bottom<=rows[index+1].getBoundingClientRect().top+1);
    })()`), "Virtual document blocks must not overlap at intermediate widths");
    fs.writeFileSync(path.join(directory, `navigation-${direction}.png`), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('.app-shell').getAnimations().forEach(a=>a.play())");
    await delay(400);
  }

  const beforeRapid = await js("document.querySelector('.app-nav').classList.contains('collapsed')");
  await js(`${click};${click};${click}`);
  await delay(500);
  assert.equal(await js("document.querySelector('.app-nav').classList.contains('collapsed')"), !beforeRapid, "Queued clicks must keep the latest intent");
  await js(click);
  await delay(500);

  // Reversal after the animation has started must carry on from the painted
  // width, preserve focus, and end with the last requested state.
  await js("document.querySelector('.nav-collapse-button').focus()");
  await js(click);
  await delay(70);
  const reversal = await js(`(() => {
    const before=document.querySelector('.app-nav').getBoundingClientRect().width;
    ${click};
    return {before,after:document.querySelector('.app-nav').getBoundingClientRect().width};
  })()`);
  assert(Math.abs(reversal.before - reversal.after) < 1, "Reversing must not jump to an endpoint");
  await delay(500);
  assert.equal(await js("document.querySelector('.app-nav').classList.contains('collapsed')"), beforeRapid);
  assert(await js("document.activeElement?.classList.contains('nav-collapse-button')"), "Toggling must retain keyboard focus");

  await js(`window.navigationReaderAnchor=()=>{
    const y=document.querySelector('.ai-file-preview-body').getBoundingClientRect().top+1;
    const row=[...document.querySelectorAll('.ai-file-preview [data-document-block]')].find(el=>{const r=el.getBoundingClientRect();return r.top<=y&&r.bottom>y});
    return row?.dataset.documentBlock;
  };document.querySelector('.ai-file-preview-body').scrollTop=document.querySelector('.ai-file-preview-body').scrollHeight/2;void 0`);
  await delay(400);
  const anchor = await js("window.navigationReaderAnchor()");
  assert(anchor, "A paragraph must be mounted at the reading position");
  for (let i = 0; i < 2; i++) {
    await js(click);
    await delay(650);
    assert.equal(await js("window.navigationReaderAnchor()"), anchor, "Navigation must preserve the reading paragraph");
  }

  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reduced = await measure("navigation-reduced-motion", click);
  assert.equal(reduced.navigationAnimated, false);
  await js(click);
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  await js("window.motionSamples.probeNavigation=false");
  await delay(250);
};

exports.checkNavigationCompanion = async ({ win, directory, js, measure, until, check, delay }) => {
  await js("document.querySelector('.app-nav button[aria-label=每日简报]').click()");
  await until("Boolean(document.querySelector('.app-shell.page-brief > .ai-sidebar .chat'))");
  await delay(650);
  await js("window.motionSamples.probeNavigation=true");
  for (const width of [1440, 1150]) {
    win.setSize(width, 1000);
    await delay(500);
    assert.equal(await js("window.innerWidth"), width, "The virtual display must fit the requested window");
    for (let i = 0; i < 2; i++) {
      const phase = await measure(`navigation-companion-${width}-${i}`, "document.querySelector('.nav-collapse-button').click()");
      assert(phase.navigationAnimated, "Companion layout changes must retain navigation motion");
      assert(phase.liveNavWidths.length > 2, "Navigation must resize continuously with a visible companion");
      check(`companion ${width} ${i} p95 frame`, phase.p95Ms, 34);
    }
  }
  fs.writeFileSync(path.join(directory, "navigation-companion.png"), (await win.webContents.capturePage()).toPNG());
  assert.equal(await js("document.querySelector('.app-shell').hasAttribute('data-nav-transitioning')"), false, "Resize guard must be released");
  await js("window.motionSamples.probeNavigation=false");
};
