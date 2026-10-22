import type {Lang} from './types';
export function tenantLoginError(error:unknown,lang:Lang):string {
 const raw=error instanceof Error?error.message:String(error||'');
 const text=raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i,'').replace(/^Error:\s*/,'');
 const table:Record<string,[string,string,string]>={
  E_TENANT_REQUIRED:['Email və parolu daxil edin.','Введите email и пароль.','Enter your email and password.'],
  E_TENANT_CREDENTIALS:['Email və ya parol səhvdir. Sahibkar hesabının parolunu yoxlayın; PIN kodu burada istifadə olunmur.','Неверный email или пароль. Используйте пароль аккаунта владельца, а не PIN.','Incorrect email or password. Use the owner account password, not the staff PIN.'],
  E_TENANT_NETWORK:['Giriş serverinə qoşulmaq mümkün olmadı. İnterneti yoxlayıb yenidən cəhd edin.','Нет связи с сервером входа. Проверьте интернет и повторите.','Cannot reach the sign-in server. Check your connection and retry.'],
  E_TENANT_RATE_LIMIT:['Çox giriş cəhdi edildi. Bir az gözləyib yenidən cəhd edin.','Слишком много попыток. Подождите и повторите.','Too many attempts. Wait briefly and retry.'],
  E_TENANT_SERVER:['Giriş serverində xəta var. Bir az sonra yenidən cəhd edin.','Ошибка сервера входа. Повторите позже.','The sign-in server is unavailable. Retry shortly.'],
  E_TENANT_RESPONSE:['Serverin giriş cavabı düzgün deyil. Yenidən cəhd edin.','Некорректный ответ сервера. Повторите.','Invalid sign-in response. Retry.']
 };
 const code=/invalid credentials|invalid cred/i.test(text)?'E_TENANT_CREDENTIALS':Object.keys(table).find(k=>text.includes(k));
 const values=code?table[code]:null;return values?values[lang==='ru'?1:lang==='en'?2:0]:text||table.E_TENANT_SERVER![lang==='ru'?1:lang==='en'?2:0];
}
