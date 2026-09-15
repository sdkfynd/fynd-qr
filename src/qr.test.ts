import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { BODY_SHAPES, FRAME_SHAPES, BALL_SHAPES } from './shapes.ts';
import { buildPayload, buildSVG, DEFAULT_DESIGN, validateDesign, recommendedPngSize, type ContentType, type Design, type Pattern } from './qr.ts';

const fixtures: [ContentType, Record<string, string>, string][] = [
  ['url', { url: 'example.com/menu?table=7&lang=en' }, 'https://example.com/menu?table=7&lang=en'],
  ['text', { text: 'Hello, नमस्ते 🌿\nA little connection.' }, 'Hello, नमस्ते 🌿\nA little connection.'],
  ['wifi', { ssid: 'Studio;Guest:2', security: 'WPA', password: 'test;pass:word\\123', hidden: 'true' }, 'WIFI:T:WPA;S:Studio\\;Guest\\:2;P:test\\;pass\\:word\\\\123;H:true;;'],
  ['email', { email: 'hello@example.com', subject: 'Hello & welcome', body: 'A new line\nWith spaces' }, 'mailto:hello@example.com?subject=Hello%20%26%20welcome&body=A%20new%20line%0AWith%20spaces'],
  ['phone', { phone: '+1 (555) 123-4567' }, 'tel:+15551234567'],
  ['sms', { phone: '+91 98765 43210', message: 'Hello & welcome 🌿' }, 'sms:+919876543210?body=Hello%20%26%20welcome%20%F0%9F%8C%BF'],
  ['contact', { firstName: 'Alex', lastName: 'Morgan', email: 'alex@example.com', phone: '+1 555 123 4567', organization: 'Studio; North', website: 'example.com' }, 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Morgan;Alex;;;\r\nFN:Alex Morgan\r\nORG:Studio\\; North\r\nEMAIL:alex@example.com\r\nTEL;TYPE=CELL:+15551234567\r\nURL:https://example.com/\r\nEND:VCARD'],
];
let scanIndex = 0;
async function decode(svg: string, size: number) {
  const { data, info } = await sharp(Buffer.from(svg)).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
  if (process.env.QR_SCAN_DIR && decoded) {
    const directory = process.env.QR_SCAN_DIR;
    await mkdir(directory,{recursive:true});
    const file = `scan-${String(++scanIndex).padStart(4,'0')}.png`;
    await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(`${directory}/${file}`);
    await appendFile(`${directory}/manifest.jsonl`,JSON.stringify({file,expected:decoded})+'\n');
  }
  return decoded;
}
for (const [type, input, expected] of fixtures) {
  test(`${type}: payload and independently decoded 512px QR match`, async () => {
    const payload = buildPayload(type, input);
    assert.equal(payload, expected);
    assert.equal(await decode(buildSVG(payload, DEFAULT_DESIGN, 512), 512), expected);
  });
}
for (const type of ['url', 'text', 'wifi', 'email', 'phone', 'sms', 'contact'] as ContentType[]) {
  test(`${type}: empty content is rejected`, () => assert.throws(() => buildPayload(type, {})));
}
test('Wi-Fi open network omits the old password', () => {
  assert.equal(buildPayload('wifi', { ssid: 'Cafe', security: 'nopass', password: 'previous' }), 'WIFI:T:nopass;S:Cafe;P:;H:false;;');
});
test('text preserves whitespace, Unicode and line breaks', () => {
  assert.equal(buildPayload('text', { text: '  leading\ntrailing  ' }), '  leading\ntrailing  ');
});
test('URL rejects unsafe schemes, embedded credentials and whitespace', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'https://user:pass@example.com', 'https://exam ple.com', 'not-a-domain']) assert.throws(() => buildPayload('url', { url }));
});
test('content length is measured in UTF-8 bytes', () => {
  assert.throws(() => buildPayload('text', { text: '🌿'.repeat(301) }), /1,200/);
  assert.equal(buildPayload('text', { text: 'a'.repeat(1200) }).length, 1200);
});
test('light or inverted codes and malformed hex colors are rejected', () => {
  for (const foreground of ['#FFFFFF', '#EEEEEE', '#123', 'red', '#fff" onload="alert(1)']) assert.throws(() => validateDesign({ ...DEFAULT_DESIGN, foreground }));
  assert.throws(() => validateDesign({ ...DEFAULT_DESIGN, background: '#000000' }));
});
test('vCard content cannot inject an additional vCard field', () => {
  const value = buildPayload('contact', { firstName: 'Alex\nURL:https://bad.example', organization: 'One, Two; Three' });
  assert.ok(value.includes('Alex\\nURL:https://bad.example'));
  assert.ok(!value.includes('\r\nURL:'));
  assert.ok(value.includes('ORG:One\\, Two\\; Three'));
});
const palettes: [string, string, string][] = [['Forest', '#173d38', '#ffffff'], ['Ink', '#242727', '#ffffff'], ['Terracotta', '#893f32', '#fff6ed'], ['Ocean', '#214c76', '#eff7ff'], ['Berry', '#653758', '#fdf2f8']];
for (const [name, foreground, background] of palettes) for (const pattern of ['square', 'rounded', 'dots'] as Pattern[]) {
  test(`${name} / ${pattern}: 512px styled SVG decodes correctly`, async () => {
    const payload = buildPayload('url', { url: 'https://example.com/hello?from=qrly' });
    assert.equal(await decode(buildSVG(payload, { foreground, background, pattern }, 512), 512), payload);
  });
}

for (const {id: pattern} of BODY_SHAPES) {
  test(`${pattern}: all 64 eye-frame / eye-ball combinations decode at 512px`, async () => {
    const failures: string[] = [];
    const payload = 'https://example.com/customized?source=fynd';
    for (const {id: eyeFrame} of FRAME_SHAPES) for (const {id: eyeBall} of BALL_SHAPES) {
      const svg = buildSVG(payload, {...DEFAULT_DESIGN, pattern, eyeFrame, eyeBall}, 512);
      if (await decode(svg, 512) !== payload) failures.push(`${eyeFrame} / ${eyeBall}`);
    }
    assert.deepEqual(failures, []);
  });
}

for (const [type, input, expected] of fixtures) {
  test(`${type}: eight mixed shapes, independent eye colors and both official logos decode`, async () => {
    for (const [i, {id: pattern}] of BODY_SHAPES.entries()) {
      const logoFile = await readFile(new URL(`../public/logos/${i % 2 ? 'impetus' : 'fynd'}.png`, import.meta.url));
      const design: Design = {...DEFAULT_DESIGN, pattern, eyeFrame: FRAME_SHAPES[(i+2)%8].id, eyeBall: BALL_SHAPES[(i+5)%8].id,
        eyeFrameColor: '#214c76', eyeBallColor: '#653758', logo: `data:image/png;base64,${logoFile.toString('base64')}`};
      const payload = buildPayload(type,input);
      assert.equal(await decode(buildSVG(payload,design,1024),1024),expected,`${pattern} / ${design.eyeFrame} / ${design.eyeBall}`);
    }
  });
}

for (const [i, {id: pattern}] of BODY_SHAPES.entries()) {
  test(`${pattern}: dense UTF-8 content, custom eyes and logo decode at 2048px`, async () => {
    const payload = 'abcdEFG!@é'.repeat(100);
    const logo = await readFile(new URL(`../public/logos/${i%2 ? 'impetus' : 'fynd'}.png`,import.meta.url));
    const design: Design = {...DEFAULT_DESIGN, pattern, eyeFrame: FRAME_SHAPES[i].id, eyeBall: BALL_SHAPES[(i+3)%8].id,
      eyeFrameColor:'#214c76',eyeBallColor:'#653758',logo:`data:image/png;base64,${logo.toString('base64')}`};
    assert.equal(await decode(buildSVG(payload,design,2048),2048),payload);
  });
}

test('unknown shapes and invalid or low-contrast eye colors are rejected', () => {
  for (const key of ['pattern','eyeFrame','eyeBall']) assert.throws(() => buildSVG('test',{...DEFAULT_DESIGN,[key]:'unknown'}));
  for (const key of ['eyeFrameColor','eyeBallColor']) for (const color of ['#ffffff','#aaaaaa','#123','red','" onload="alert(1)']) {
    assert.throws(() => buildSVG('test',{...DEFAULT_DESIGN,[key]:color}));
  }
});

test('every gallery choice changes only its intended rendered QR part', () => {
  const payload = 'https://example.com/independent-parts';
  const groups = (design: Design) => buildSVG(payload,design).match(/<g\b[^>]*>.*?<\/g>/g)!;
  const original = groups(DEFAULT_DESIGN);
  for (const [key,choices,indices] of [
    ['pattern',BODY_SHAPES,[0]], ['eyeFrame',FRAME_SHAPES,[1,3,5]], ['eyeBall',BALL_SHAPES,[2,4,6]],
  ] as const) for (const choice of choices.filter(c => c.id !== 'square')) {
    const changed = groups({...DEFAULT_DESIGN,[key]:choice.id});
    original.forEach((part,index) => {
      if ((indices as readonly number[]).includes(index)) assert.notEqual(changed[index],part,`${key} ${choice.id} should change`);
      else assert.equal(changed[index],part,`${key} should preserve other parts`);
    });
  }
  for (const [key,indices] of [['eyeFrameColor',[1,3,5]],['eyeBallColor',[2,4,6]]] as const) {
    const changed = groups({...DEFAULT_DESIGN,[key]:'#214c76'});
    original.forEach((part,index) => {
      if ((indices as readonly number[]).includes(index)) assert.ok(changed[index].includes('fill="#214c76"'));
      else assert.equal(changed[index],part);
    });
  }
});
for (const pattern of ['square', 'rounded', 'dots'] as Pattern[]) {
  test(`${pattern}: small raster logo remains decodable`, async () => {
    const logo = await sharp({ create: { width: 120, height: 120, channels: 4, background: '#ed7959' } }).png().toBuffer();
    const design: Design = { ...DEFAULT_DESIGN, pattern, logo: `data:image/png;base64,${logo.toString('base64')}` };
    for (const payload of ['https://example.com/', fixtures[6][2], 'A'.repeat(550)]) {
      assert.equal(await decode(buildSVG(payload, design, 512), 512), payload);
    }
  });
}
test('dense content selects a larger image and decodes at 2048px', async () => {
  const payload = 'abcdEFG!@é'.repeat(100); // 1,100 UTF-8 bytes.
  assert.equal(recommendedPngSize(payload), 2048);
  assert.equal(await decode(buildSVG(payload, DEFAULT_DESIGN, 2048), 2048), payload);
});
test('external images and markup cannot enter exported SVG', () => {
  const svg = buildSVG('https://example.com/', { ...DEFAULT_DESIGN, logo: 'https://external.example/logo.png' });
  assert.ok(!svg.includes('<image'));
  assert.ok(!svg.includes('external.example'));
});

for (const [name, foreground, background] of palettes) for (const pattern of ['square', 'rounded', 'dots'] as Pattern[]) {
  test(`${name} / ${pattern}: logo and both custom colors decode together`, async () => {
    const logo = await sharp({ create: { width: 120, height: 80, channels: 4, background: '#ed7959' } }).png().toBuffer();
    const design: Design = { foreground, background, pattern, logo: `data:image/png;base64,${logo.toString('base64')}` };
    const payload = 'https://example.com/customized?source=qa';
    assert.equal(await decode(buildSVG(payload, design, 512), 512), payload);
  });
}
