import{createRoot}from'react-dom/client';
import{QrMenu}from'../src/components/qr/QrMenu';
document.body.style.margin='0';createRoot(document.getElementById('root')!).render(<QrMenu menuToken={'a'.repeat(48)} tableToken={'b'.repeat(48)}/>);
