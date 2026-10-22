import { Buffer } from 'node:buffer';
import { PNG } from 'pngjs';
import { inflateSync } from 'node:zlib';
import { APIError } from './validation.ts';

// Pure JavaScript PNG processing runs on Edge Functions without native binaries.
export function normalizeEdgeLogo(image: string) {
  if (image.length > 330_000 || !/^data:image\/png;base64,[A-Za-z\d+/]+=*$/.test(image)) throw new APIError(400, 'Use a PNG logo prepared by the editor.');
  try {
    const input = Buffer.from(image.slice(22), 'base64');
    if (input.length < 33 || !input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || input.toString('ascii',12,16) !== 'IHDR') throw new Error('Not PNG');
    const width = input.readUInt32BE(16), height = input.readUInt32BE(20);
    if (!width || !height || width > 240 || height > 240 || input[24]!==8 || ![2,6].includes(input[25]) || input[26]!==0 || input[27]!==0 || input[28]!==0) throw new Error('Use a bounded non-interlaced editor PNG');
    let offset=8,seenHeader=false,ended=false;
    const compressed:Buffer[]=[];
    while (offset<input.length) {
      if (input.length-offset<12) throw new Error('Truncated PNG');
      const length=input.readUInt32BE(offset),type=input.toString('ascii',offset+4,offset+8);
      if (length>input.length-offset-12) throw new Error('Invalid chunk length');
      if (type==='IHDR') { if (seenHeader || offset!==8 || length!==13) throw new Error('Duplicate header'); seenHeader=true; }
      if (type==='IDAT') compressed.push(input.subarray(offset+8,offset+8+length));
      offset+=length+12;
      if (type==='IEND') { if (length!==0 || offset!==input.length) throw new Error('Invalid PNG end'); ended=true; }
    }
    if (!seenHeader || !ended || !compressed.length) throw new Error('Incomplete PNG');
    // Reject expansion bombs before pngjs can allocate its decoding buffers.
    const expected=height*(1+width*(input[25]===6?4:3));
    if (inflateSync(Buffer.concat(compressed),{maxOutputLength:expected}).length!==expected) throw new Error('Invalid pixel data');
    const png = PNG.sync.read(input, { checkCRC: true });
    const buffer = PNG.sync.write(png, { colorType: 6 });
    const thumb = new PNG({ width: 96, height: 96 });
    const ratio = Math.min(96 / width, 96 / height), w = Math.max(1,Math.round(width * ratio)), h = Math.max(1,Math.round(height * ratio));
    const left = Math.floor((96-w)/2), top = Math.floor((96-h)/2);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const source = (Math.min(height-1,Math.floor(y/ratio))*width+Math.min(width-1,Math.floor(x/ratio)))*4;
      png.data.copy(thumb.data, ((y+top)*96+x+left)*4, source, source+4);
    }
    return { buffer, image: `data:image/png;base64,${buffer.toString('base64')}`,
      thumbnail: `data:image/png;base64,${PNG.sync.write(thumb,{colorType:6}).toString('base64')}` };
  } catch { throw new APIError(400, 'This logo could not be read. Upload a valid PNG, JPG or WebP through the editor.'); }
}
