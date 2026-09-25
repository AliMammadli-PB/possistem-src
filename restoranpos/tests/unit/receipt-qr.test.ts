import {describe,it,expect} from 'vitest';
import jsQR from 'jsqr';
// Generated offline QR encoder, used by legacy consumers as well as diagnostic tools.
// @ts-expect-error recovered renderer ships JavaScript modules
import {psQrMatrix,psQrDataUrl} from '../../scripts/lib/ps-qr.mjs';
function decode(matrix:boolean[][]) {
  const scale=5,side=(matrix.length+8)*scale,pixels=new Uint8ClampedArray(side*side*4).fill(255);
  matrix.forEach((row,y)=>row.forEach((on,x)=>{if(on)for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
    const at=(((y+4)*scale+dy)*side+(x+4)*scale+dx)*4;pixels[at]=pixels[at+1]=pixels[at+2]=0;
  }}));
  return jsQR(pixels,side,side)?.data;
}
describe('receipt QR survives independent decoding',()=>{
  for(const text of ['https://example.com/menu','https://example.com/'+ 'a'.repeat(180)+'?tail=complete','https://example.com/Əli-Şəki?məhsul=çay','https://maps.example.com/place/Baku?lat=40.4093&lng=49.8671&label='+ 'Restaurant'.repeat(18)]) {
    it(`preserves ${new TextEncoder().encode(text).length} UTF-8 bytes`,()=>expect(decode(psQrMatrix(text))).toBe(text));
  }
  it('does not collapse links sharing their first 106 bytes',()=>{
    const base='https://example.com/'+'x'.repeat(150);
    expect(decode(psQrMatrix(base+'A'))).toBe(base+'A');expect(decode(psQrMatrix(base+'B'))).toBe(base+'B');
  });
  it('fails instead of truncating unsupported data',()=>expect(()=>psQrMatrix('x'.repeat(4000))).toThrow());
  it('has four modules of quiet zone and no fake empty code',()=>{
    const matrix=psQrMatrix('hello'),svg=decodeURIComponent(psQrDataUrl('hello').split(',')[1]);
    expect(svg).toContain(`viewBox="0 0 ${matrix.length+8} ${matrix.length+8}"`);
    expect(psQrDataUrl('')).toBe('');
  });
});
