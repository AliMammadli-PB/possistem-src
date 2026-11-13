import importlib.util,unittest
from pathlib import Path
import numpy as np
from PIL import Image
spec=importlib.util.spec_from_file_location('mask_scan',Path(__file__).with_name('mask-scan.py'));mask_scan=importlib.util.module_from_spec(spec);spec.loader.exec_module(mask_scan)
class MaskTests(unittest.TestCase):
 def test_subject_keeps_openings_and_excludes_separate_background(self):
  image=np.zeros((300,400),dtype=np.uint8);image[60:250,80:310]=255;image[100:150,100:150]=0;image[10:40,350:380]=255
  mask,coverage=mask_scan.clean_mask(Image.fromarray(image));a=np.asarray(mask)
  self.assertEqual(a.shape,image.shape);self.assertEqual(a[125,125],0);self.assertEqual(a[20,360],0);self.assertEqual(a[200,200],255);self.assertGreater(coverage,.1)
 def test_hairline_background_bridge_removed(self):
  image=np.zeros((400,400),dtype=np.uint8);image[110:300,100:280]=255;image[180:182,280:380]=255
  mask,_=mask_scan.clean_mask(Image.fromarray(image));a=np.asarray(mask)
  self.assertEqual(a[180,350],0);self.assertEqual(a[200,200],255)
 def test_empty_and_full_masks_rejected(self):
  for value in [0,255]:
   with self.assertRaises(ValueError):mask_scan.clean_mask(Image.fromarray(np.full((200,200),value,dtype=np.uint8)))
 def test_implausibly_small_subject_rejected(self):
  image=np.zeros((200,200),dtype=np.uint8);image[90:95,90:95]=255
  with self.assertRaises(ValueError):mask_scan.clean_mask(Image.fromarray(image))
 def test_detail_metric_detects_lost_edges(self):
  from PIL import ImageFilter
  grid=np.indices((256,256)).sum(axis=0)//5%2*255;sharp=Image.fromarray(grid.astype('uint8')).convert('RGB');blur=sharp.filter(ImageFilter.GaussianBlur(4));mask=Image.new('L',sharp.size,255)
  self.assertGreater(mask_scan.sharpness(sharp,mask),mask_scan.sharpness(blur,mask)*5)
if __name__=='__main__':unittest.main()
