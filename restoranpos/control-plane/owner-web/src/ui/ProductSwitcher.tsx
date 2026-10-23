import {useLocation,useNavigate} from 'react-router-dom';
import {useAuth} from '../auth/AuthContext';
import {ownerProductLabels,type OwnerProduct} from '../api';
import {Icon} from './Icon';
export function ProductSwitcher(){
 const {availableProducts,selectedProduct,selectProduct}=useAuth(),location=useLocation(),navigate=useNavigate();
 if(!availableProducts.length)return null;
 const change=(product:OwnerProduct)=>{selectProduct(product);const search=new URLSearchParams(location.search);search.delete('device');if(product!=='restaurant'&&location.pathname==='/masalar'){navigate('/');return;}navigate({pathname:location.pathname,search:search.toString()?`?${search}`:''},{replace:true});};
 return <div className="wb-product-selector"><Icon name={selectedProduct==='restaurant'?'table':'building'} size={19}/>{availableProducts.length>1?<label><span className="sr-only">POS seçimi</span><select aria-label="POS seçimi" value={selectedProduct||availableProducts[0]} onChange={e=>change(e.target.value as OwnerProduct)}>{availableProducts.map(p=><option key={p} value={p}>{ownerProductLabels[p]}</option>)}</select></label>:<strong>{ownerProductLabels[availableProducts[0]]}</strong>}</div>;
}
