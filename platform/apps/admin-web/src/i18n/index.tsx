import { createContext, useContext, type ReactNode } from 'react';
import { az, type AdminI18n } from './az';

const I18nContext = createContext<AdminI18n>(az);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={az}>{children}</I18nContext.Provider>;
}

export function useI18n(): AdminI18n {
  return useContext(I18nContext);
}
