const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 2000 });
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  const climbers = [
    { name: '黄海锋', bio: '2323\n2323\n2323\n2323' },
    { name: '王学伟', bio: '2323\n2323\n2323\n2323' },
    { name: '三水', bio: '2323\n2323\n2323\n2323' },
    { name: '李明', bio: '2323\n2323\n2323\n2323' },
  ];

  for (const c of climbers) {
    const nameInput = await page.$('input[placeholder="定线员名字"]');
    await nameInput.click({ clickCount: 3 });
    await nameInput.type(c.name);
    const bioInput = await page.$('textarea[placeholder="定线员简介和成就"]');
    if (bioInput) { await bioInput.click({ clickCount: 3 }); await bioInput.type(c.bio); }
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && text.includes('添加')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 800));
  }
  await new Promise(r => setTimeout(r, 1000));

  const data = await page.evaluate(() => {
    const allDivs = Array.from(document.querySelectorAll('div'));
    
    // 找海报容器
    const poster = allDivs.find(d => {
      const cs = window.getComputedStyle(d);
      return cs.overflow === 'hidden' && cs.aspectRatio && cs.aspectRatio !== 'auto';
    });
    const posterRect = poster ? poster.getBoundingClientRect() : null;
    
    // 找半圆（绝对定位+圆形）
    const circles = allDivs.filter(d => {
      const cs = window.getComputedStyle(d);
      return cs.position === 'absolute' && cs.borderRadius === '50%';
    });
    
    // 找胶囊（border-radius:999px）
    const capsules = allDivs.filter(d => {
      const cs = window.getComputedStyle(d);
      return cs.borderRadius && cs.borderRadius.includes('999') && cs.backgroundColor === 'rgb(255, 255, 255)';
    });
    
    return {
      posterRect: posterRect ? { x: Math.round(posterRect.x), right: Math.round(posterRect.right), width: Math.round(posterRect.width) } : null,
      circles: circles.slice(0,1).map(d => {
        const r = d.getBoundingClientRect();
        return { x: Math.round(r.x), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
      }),
      capsules: capsules.slice(0,1).map(d => {
        const r = d.getBoundingClientRect();
        return { x: Math.round(r.x), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
      })
    };
  });
  
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
