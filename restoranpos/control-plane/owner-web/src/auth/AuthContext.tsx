import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import * as api from '../api';

type AuthStatus = 'loading' | 'authenticated' | 'guest';

type AuthContextValue = {
  status: AuthStatus;
  customer: api.Customer | null;
  onboardingComplete: boolean;
  currentStep: number;
  selectedProduct: api.OwnerProduct|null;
  selectProduct:(product:api.OwnerProduct)=>void;
  licenseProduct: api.OwnerProduct | null;
  availableProducts: Array<api.OwnerProduct>;
  signIn: (email: string, password: string, rememberMe: boolean) => Promise<api.SessionPayload>;
  signUp: (input: Parameters<typeof api.register>[0]) => Promise<api.SessionPayload>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  patchCustomer: (partial: Partial<api.Customer>) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
let bootstrapRequest: Promise<api.SessionPayload> | null = null;

function loadSession() {
  bootstrapRequest ??= api.session().finally(() => {
    window.setTimeout(() => {
      bootstrapRequest = null;
    }, 0);
  });
  return bootstrapRequest;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [customer, setCustomer] = useState<api.Customer | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedProduct,setSelectedProduct]=useState<api.OwnerProduct|null>(null);
  const selected=useRef<{owner:string;product:api.OwnerProduct|null}|null>(null);
  const [licenseProduct, setLicenseProduct] = useState<api.OwnerProduct | null>(null);
  const [availableProducts, setAvailableProducts] = useState<Array<api.OwnerProduct>>([]);

  const apply = useCallback((payload: api.SessionPayload) => {
    const choices=(payload.availableProducts?.length?payload.availableProducts:payload.licenseProduct?[payload.licenseProduct]:[]).filter(p=>p in api.ownerProductLabels);
    let stored:api.OwnerProduct|null=null;try{stored=localStorage.getItem('possistem-owner-product:'+payload.customer.id) as api.OwnerProduct|null;}catch{}
    const previous=selected.current?.owner===payload.customer.id?selected.current.product:null;
    const next=previous&&choices.includes(previous)?previous:stored&&choices.includes(stored)?stored:choices[0]??null;
    selected.current={owner:payload.customer.id,product:next};api.setPortalProduct(next);setSelectedProduct(next);
    setCustomer(payload.customer);
    setOnboardingComplete(payload.onboardingComplete);
    setCurrentStep(payload.currentStep ?? (payload.onboardingComplete ? 7 : 1));
    setLicenseProduct(payload.licenseProduct ?? null);
    setAvailableProducts(choices);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    selected.current=null;api.setPortalProduct(null);setSelectedProduct(null);
    setCustomer(null);
    setOnboardingComplete(false);
    setCurrentStep(1);
    setLicenseProduct(null);
    setAvailableProducts([]);
    setStatus('guest');
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.session());
    } catch {
      clear();
    }
  }, [apply, clear]);

  const patchCustomer = useCallback((partial: Partial<api.Customer>) => {
    setCustomer((current) => (current ? { ...current, ...partial } : current));
  }, []);

  useEffect(() => {
    let active = true;
    void loadSession()
      .then((payload) => {
        if (active) apply(payload);
      })
      .catch(() => {
        if (active) clear();
      });
    const onUnauthorized = () => clear();
    window.addEventListener('possistem:unauthorized', onUnauthorized);
    return () => {
      active = false;
      window.removeEventListener('possistem:unauthorized', onUnauthorized);
    };
  }, [apply, clear]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      customer,
      onboardingComplete,
      currentStep,
      selectedProduct,
      selectProduct:(product)=>{if(!customer||!availableProducts.includes(product))return;selected.current={owner:customer.id,product};api.setPortalProduct(product);setSelectedProduct(product);try{localStorage.setItem('possistem-owner-product:'+customer.id,product);}catch{}},
      licenseProduct,
      availableProducts,
      signIn: async (email, password, rememberMe) => {
        const payload = await api.login(email, password, rememberMe);
        apply(payload);
        return payload;
      },
      signUp: async (input) => {
        const payload = await api.register(input);
        apply(payload);
        return payload;
      },
      signOut: async () => {
        try {
          await api.logout();
        } finally {
          clear();
        }
      },
      refresh,
      patchCustomer,
    }),
    [selectedProduct, apply, availableProducts, clear, currentStep, customer, licenseProduct, onboardingComplete, patchCustomer, refresh, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <AuthBootScreen />;
  if (auth.status === 'guest') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <AuthBootScreen />;
  if (auth.status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthBootScreen() {
  return (
    <main className="boot-screen" aria-busy="true" aria-label="Hesab yoxlanılır">
      <a href="/" aria-label="Possistem ana səhifə"><img
        className="boot-mark"
        src={`${import.meta.env.BASE_URL}possistem-logo.png`}
        alt=""
        width={52}
        height={52}
      /></a>
      <div className="boot-progress" />
      <p>Hesab yoxlanılır…</p>
    </main>
  );
}
