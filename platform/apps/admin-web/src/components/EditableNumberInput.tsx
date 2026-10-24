import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  decimals?: number;
  validationMessage?: string;
};

/** Keep the typed string intact, including an empty field and a trailing decimal separator. */
export function EditableNumberInput({value,onValueChange,min=0,max,decimals=0,validationMessage,...props}: Props) {
  const [raw,setRaw]=useState(String(value));
  const focused=useRef(false);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!focused.current)setRaw(String(value));},[value]);
  const normalized=raw.trim().replace(',', '.');
  const number=normalized===''?0:Number(normalized);
  const pattern=decimals?new RegExp(`^\\d*(?:\\.\\d{0,${decimals}})?$`):/^\d+$/;
  const valid=(normalized===''&&min===0)||(pattern.test(normalized)&&Number.isFinite(number)&&number>=min&&(max===undefined||number<=max));
  const message=valid?'':validationMessage??(decimals?'Düzgün qiymət yazın (ən çox iki onluq rəqəm).':'İcazə verilən aralıqda tam say yazın.');
  useEffect(()=>{input.current?.setCustomValidity(message);},[message]);
  return <input {...props} ref={input} type="text" inputMode={decimals?'decimal':'numeric'}
    value={raw} aria-invalid={!valid||undefined}
    onFocus={()=>{focused.current=true;}}
    onBlur={()=>{focused.current=false;}}
    onChange={event=>{
      const next=event.target.value;
      setRaw(next);
      const text=next.trim().replace(',', '.');
      const parsed=text===''?0:Number(text);
      if(text===''||(pattern.test(text)&&Number.isFinite(parsed)&&parsed>=min&&(max===undefined||parsed<=max)))onValueChange(parsed);
    }}/>
}
