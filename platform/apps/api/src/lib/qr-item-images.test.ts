import {test} from 'node:test';import assert from 'node:assert/strict';import {withQrItemImages} from './qr-item-images.js';
test('menu artwork fills missing images while preserving merchant pictures, prices, modifiers and source data',()=>{
 const menu={name:'Pizza',items:[{id:'a',image:'',priceMinor:1200,groups:[{id:'size'}]},{id:'b',image:'https://owner.test/photo.webp',priceMinor:100}]},before=structuredClone(menu);
 const merged=withQrItemImages(menu,[{product_id:'a',image:'https://possistem.az/pizza.webp'},{product_id:'b',image:'https://possistem.az/other.webp'},{product_id:'unknown',image:'https://possistem.az/x.webp'}]);
 assert.equal(merged.items[0].image,'https://possistem.az/pizza.webp');assert.equal(merged.items[1].image,menu.items[1].image);assert.equal(merged.items[0].priceMinor,1200);assert.deepEqual(merged.items[0].groups,[{id:'size'}]);assert.deepEqual(menu,before);assert.equal(merged.items.length,2);
});
test('invalid image schemes are ignored and fallback survives a POS menu republish',()=>{const art=[{product_id:'a',image:'data:image/svg+xml,x'},{product_id:'b',image:'https://possistem.az/b.webp'}];const menu={items:[{id:'a',image:''},{id:'b',image:''}]};assert.equal(withQrItemImages(menu,art).items[0].image,'');assert.equal(withQrItemImages(structuredClone(menu),art).items[1].image,art[1].image)});
