import React, { useEffect, useRef, useState } from 'react';
import { Spinner } from '../components/Spinner';
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';
import './loginTheme.css';
import { TurnstileWidget } from '../components/TurnstileWidget';
import { isPasswordAcceptable } from '../utils/passwordStrength';
import { User } from '../types';
import { dbService } from '../services/db';
import { OperationStatusModal } from '../components/OperationStatusModal';
import { runGlobalOperation, showOperationSuccess } from '../context/OperationContext';
import { compressImageFile } from '../utils/imageCompressor';
import { TERMS_VERSION, TERMS_URL } from '../utils/legalTerms';
import { getLoginLockState, registerFailedLogin, clearFailedLogins } from '../services/securityPolicy';
import { recoveryPending, supabase, signupConfirmPending, signupLinkError, clearSignupConfirmPending } from '../services/supabase';
import { setRemembered, touchActivity } from '../services/sessionActivity';
import { writeOfflineLease } from '../services/offlineLease';
import { markLoginBusy } from '../services/localVault';
import {
  signIn as sbSignIn, verifyMfa, enrollTotp, loadProfile, mfaSatisfied, hasVerifiedTotp, MFA_ENABLED, completeSchoolRegistration,
  sendPasswordReset as sbSendReset, resendConfirmationEmail, SignInError, updateOwnPassword, signOutUser as sbSignOut, isServerLockMessage, getPasswordGate, passwordGateBlocks, MFA_REQUIRED_ROLES
} from '../services/authSupabase';
import { Notice, NoticeButton } from '../components/Notice';

interface LoginViewProps {
  onLoginSuccess: (user: User) => void;
}

/** Imagem de fundo do ecrã de entrada: coloque o ficheiro em public/login-bg.jpg. Sem ele aparece só o degradê azul. */
export const LOGIN_BG = '/login-bg.jpg';
const LOGIN_BG_STYLE: React.CSSProperties = {
  backgroundImage:
    `linear-gradient(90deg, rgba(3,14,40,0.05) 0%, rgba(3,14,40,0.35) 52%, rgba(3,14,40,0.82) 100%), url(${LOGIN_BG}), ` +
    'radial-gradient(900px 600px at 15% 20%, #1d6fd1 0%, transparent 60%), radial-gradient(800px 700px at 85% 90%, #0b3a8f 0%, transparent 60%), linear-gradient(180deg, #06214f, #04132f)',
  backgroundSize: 'cover, cover, auto, auto, auto',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'fixed'
};

const DEFAULT_NEW_AVATAR = '/avatar-padrao.png';

type ViewMode = 'login' | 'register-admin' | 'register-institution' | 'forgot' | 'mfa' | 'mfa-enroll' | 'new-password' | 'force-password' | 'confirming-registration' | 'registration-done';

interface AdminFormState {
  name: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  avatar: string;
}

interface InstitutionFormState {
  schoolName: string;
  nif: string;
  province: string;
  municipality: string;
  address: string;
  phone: string;
  email: string;
  currentAcademicYear: string;
}

const emptyAdminForm = (): AdminFormState => ({
  name: '',
  email: '',
  username: '',
  password: '',
  confirmPassword: '',
  avatar: DEFAULT_NEW_AVATAR
});

const emptyInstitutionForm = (): InstitutionFormState => ({
  schoolName: '',
  nif: '',
  province: '',
  municipality: '',
  address: '',
  phone: '',
  email: '',
  currentAcademicYear: new Date().getFullYear() + '/' + (new Date().getFullYear() + 1)
});

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<ViewMode>(recoveryPending ? 'new-password' : signupConfirmPending ? 'confirming-registration' : 'login');
  const [forceReason, setForceReason] = useState<'temporaria' | 'expirada'>('temporaria');
  const loginPasswordRef = React.useRef('');   // só em memória, para cifrar o lease offline; limpa no fim do login

  // Recuperação de palavra-passe / 2FA
  const [forgotEmail, setForgotEmail] = useState('');
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [newPw, setNewPw] = useState('');
  const [newPwFocus, setNewPwFocus] = useState(false);
  const [adminPwFocus, setAdminPwFocus] = useState(false);
  const [newPw2, setNewPw2] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{ qr: string; secret: string; factorId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** E-mail da conta que tentou entrar sem ter confirmado o endereço: habilita "Reenviar link de confirmação". */
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);   // segundos até poder pedir outro link (o Supabase limita a 1/min)
  const [resendInfo, setResendInfo] = useState<string | null>(null);

  // Registration state
  const [adminForm, setAdminForm] = useState<AdminFormState>(emptyAdminForm());
  const [institutionForm, setInstitutionForm] = useState<InstitutionFormState>(emptyInstitutionForm());
  const [registerError, setRegisterError] = useState<string | null>(null);
  /** E-mail para onde foi enviado o link de confirmação (a escola só é criada depois de o abrir). */
  const [createdSchool, setCreatedSchool] = useState<{ name: string; email: string } | null>(null);
  const confirmStarted = useRef(false);
  const [registrationSentTo, setRegistrationSentTo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const resetCaptcha = () => { setCaptchaToken(null); setCaptchaKey((k) => k + 1); };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  /** Reenvia o link de confirmação para o e-mail que acabou de falhar o login (o captcha é de uso único: pede-se um novo). */
  const handleResendConfirmation = async () => {
    if (!unconfirmedEmail || resendBusy || resendCooldown > 0) return;
    if (!captchaToken) { setErrorMessage('Confirme o captcha (\"Não sou um robô\") por baixo e carregue em "Reenviar link de confirmação".'); return; }
    setResendBusy(true);
    try {
      const token = captchaToken;
      resetCaptcha();
      const r = await resendConfirmationEmail(unconfirmedEmail, token);
      if (!r.success) { setErrorMessage(r.error || 'Não foi possível reenviar o link.'); setResendCooldown(r.error?.includes('1 minuto') ? 60 : 0); return; }
      setErrorMessage(null);
      setResendInfo(`Enviámos um novo link de confirmação para ${unconfirmedEmail}. Abra-o e depois inicie sessão. Verifique também o spam.`);
      setResendCooldown(60);
    } finally { setResendBusy(false); }
  };

  // Link de confirmação do e-mail aberto (registo de escola): cria a escola, termina a sessão e mostra a caixa verde
  // com o botão para iniciar sessão. Não entra na app sozinho: a pessoa inicia sessão com a palavra-passe que escolheu.
  useEffect(() => {
    if (!signupConfirmPending || confirmStarted.current) return;
    confirmStarted.current = true;
    void (async () => {
      const backToLogin = (msg: string) => { setErrorMessage(msg); setMode('login'); };
      try {
        const { data } = await supabase.auth.getSession();   // espera o cliente processar o link do e-mail
        if (!data.session) {
          backToLogin(signupLinkError
            ? 'O link de confirmação expirou ou já foi usado. Se já confirmou o e-mail, inicie sessão; caso contrário, registe a escola novamente.'
            : 'Não foi possível validar o link de confirmação. Tente abri-lo novamente.');
          return;
        }
        const done = await completeSchoolRegistration();
        const email = done?.email || data.session.user.email || '';
        clearSignupConfirmPending();   // antes de sair: o App volta a limpar os dados locais da escola acabada de criar
        await sbSignOut();
        if (email) setIdentifier(email);
        if (done) { setCreatedSchool({ name: done.schoolName, email }); setMode('registration-done'); }
        else { setInfoMessage('E-mail confirmado com sucesso. Já pode iniciar sessão.'); setMode('login'); }
      } catch (e: any) {
        clearSignupConfirmPending();
        try { await sbSignOut(); } catch { /* ignore */ }
        backToLogin(e?.message || 'E-mail confirmado, mas não foi possível criar a escola agora. Inicie sessão para concluir.');
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null); setUnconfirmedEmail(null); setResendInfo(null);

    // POLÍTICA "TENTATIVAS FALHADAS" (Configurações → Segurança & Backups):
    // após o número de falhas consecutivas configurado, esta credencial fica
    // temporariamente bloqueada neste posto e o evento vai para a auditoria.
    const lockState = getLoginLockState(identifier);
    if (lockState.locked) {
      setErrorMessage(
        `Este acesso está temporariamente bloqueado. Tente novamente dentro de ${lockState.remainingMinutes} minuto(s).`
      );
      return;
    }

    if (!captchaToken) {
      setErrorMessage('Confirme o captcha ("Não sou um robô") para entrar.');
      return;
    }

    setBusy(true);
    setLoading(true);
    markLoginBusy(true);   // o arranque da app não pode tratar este login como "navegador reaberto" (cofre local)
    try {
      // Aceita e-mail, nome de utilizador ou nº de processo (resolvidos na lista local de utilizadores).
      const email = dbService.resolveLoginEmail(identifier);
      if (!email) {
        const attempt = registerFailedLogin(identifier);
        setErrorMessage(attempt.locked
          ? 'Demasiadas tentativas. Este acesso fica bloqueado durante 15 minutos.'
          : 'Neste dispositivo só é possível entrar com o e-mail. Introduza o e-mail da sua conta.');
        return;
      }
      // Onde guardar a sessão (Lembrar-me → 60 min de inatividade; sem Lembrar-me → termina ao fechar o navegador).
      setRemembered(rememberMe);
      touchActivity(true);   // antes de entrar: o evento de sessão não pode ver uma atividade antiga
      const token = captchaToken;
      resetCaptcha();   // o token é de uso único
      // Carregamento global ("A verificar os dados...") durante a autenticação; se falhar, mostra o erro
      // e a mensagem aparece também no formulário.
      let r: Awaited<ReturnType<typeof sbSignIn>>;
      try {
        r = await runGlobalOperation(
          async () => {
            const res = await sbSignIn(email, password, token);
            if (!res.success) throw new SignInError(res.error || 'Não foi possível entrar.', res.code);
            return res;
          },
          { loadingMessage: 'A verificar os dados...', successMessage: 'Bem-vindo!', errorMessage: 'Não foi possível entrar', successDuration: 500 }
        );
      } catch (err: any) {
        // Bloqueio do SERVIDOR (fonte de verdade): mostra a mensagem dele. O contador local é só conforto de interface.
        if (isServerLockMessage(err?.message)) { setErrorMessage(err.message); return; }
        // E-mail por confirmar: a palavra-passe está certa, por isso não conta como tentativa falhada; oferece reenviar o link.
        if (err instanceof SignInError && err.code === 'email_not_confirmed') {
          setUnconfirmedEmail(email); setResendCooldown(0);
          setErrorMessage(err.message);
          return;
        }
        const attempt = registerFailedLogin(identifier);
        setErrorMessage(attempt.locked ? 'Demasiadas tentativas. Este acesso fica bloqueado durante 15 minutos.' : err?.message || 'Não foi possível entrar.');
        return;
      }
      clearFailedLogins(identifier);
      loginPasswordRef.current = password;
      if (r.needsMfa && r.factorId) { setMfaFactorId(r.factorId); setMfaCode(''); setMode('mfa'); return; }
      await finishSupabaseLogin();
    } finally { markLoginBusy(false); setBusy(false); setLoading(false); }
  };

  /** Depois de password (+ código): carrega o perfil e exige 2FA aos perfis sensíveis. */
  const finishSupabaseLogin = async () => {
    let profile: Awaited<ReturnType<typeof loadProfile>>;
    try {
      profile = await loadProfile({ force: true });
    } catch (e: any) {
      // Servidor lento/indisponível (ex.: 504): não é falta de perfil. A conta não é alterada.
      await sbSignOut();
      setErrorMessage(e?.message || 'Servidor temporariamente indisponível. Tente novamente dentro de instantes.');
      setMode('login');
      return;
    }
    if (!profile) {
      await sbSignOut();
      setErrorMessage('A sua conta não tem perfil activo no sistema. Contacte o administrador.');
      setMode('login');
      return;
    }
    if (!(await mfaSatisfied(profile.role))) {
      // Perfil que exige 2FA mas ainda sem código nesta sessão: inscrever (primeira vez) ou pedir o código.
      if (await hasVerifiedTotp()) { await sbSignOut(); setErrorMessage('Inicie sessão novamente para introduzir o código 2FA.'); setMode('login'); return; }
      try { setEnroll(await enrollTotp()); } catch (e: any) { await sbSignOut(); setErrorMessage(e?.message || 'Não foi possível activar o 2FA.'); setMode('login'); return; }
      setMfaCode(''); setMode('mfa-enroll'); return;
    }
    // Palavra-passe temporária (conta criada pelo administrador) ou expirada: o SERVIDOR já recusa os dados (RLS);
    // aqui obriga-se a definir uma nova antes de continuar (migração 0045).
    const gate = await getPasswordGate();
    if (passwordGateBlocks(gate)) {
      setForceReason(gate.mustChange ? 'temporaria' : 'expirada');
      setNewPw(''); setNewPw2(''); setErrorMessage(null); setMode('force-password');
      return;
    }
    // Cofre local: a palavra-passe acabou de ser confirmada pelo servidor. Cria/abre a chave que cifra a cópia deste aparelho.
    if (loginPasswordRef.current) await dbService.setupLocalVault(loginPasswordRef.current);
    // Carrega a escola, as permissões e os dados (tempo real) para esta sessão.
    const user = await dbService.restoreSession(profile.id);
    if (!user) {
      await sbSignOut();
      setErrorMessage('Não foi possível carregar os dados da sua escola. Tente novamente.');
      setMode('login');
      return;
    }
    // Perfis com 2FA: autoriza este aparelho a abrir a cópia local sem internet durante alguns dias (login online completo,
    // 2FA cumprido). O lease é cifrado com a palavra-passe; ver src/services/offlineLease.ts.
    if (MFA_ENABLED && MFA_REQUIRED_ROLES.includes(user.role) && loginPasswordRef.current) {
      try { await writeOfflineLease(localStorage, loginPasswordRef.current, { uid: user.id, role: user.role, mfa: true }); }
      catch (err) { console.warn('Não foi possível autorizar o modo offline neste aparelho:', err); }
    }
    loginPasswordRef.current = '';
    if (rememberMe) {
      try { localStorage.setItem('bandmed_session_user', JSON.stringify(user)); } catch (err) { console.warn('Erro ao salvar sessão:', err); }
    }
    onLoginSuccess(user);
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    const factorId = mode === 'mfa-enroll' ? enroll?.factorId : mfaFactorId;
    if (!factorId) return;
    setBusy(true); setErrorMessage(null);
    markLoginBusy(true);
    try {
      const r = await verifyMfa(factorId, mfaCode);
      if (!r.success) { setErrorMessage(r.error || 'Código incorreto.'); return; }
      setEnroll(null); setMfaCode('');
      await finishSupabaseLogin();
    } finally { markLoginBusy(false); setBusy(false); }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null); setInfoMessage(null);
    const email = forgotEmail.trim();
    if (!email.includes('@')) { setErrorMessage('Introduza o e-mail da sua conta.'); return; }
    if (!captchaToken) { setErrorMessage('Confirme o captcha ("Não sou um robô").'); return; }
    setBusy(true);
    try {
      const token = captchaToken;
      resetCaptcha();
      const r = await sbSendReset(email, token);
      if (!r.success) { setErrorMessage(r.error || 'Não foi possível enviar.'); return; }
      // Resposta igual exista ou não a conta: não revela quem está registado.
      void showOperationSuccess('Pedido enviado com sucesso!', {
        details: 'Se existir uma conta com este e-mail, enviámos um link para definir nova palavra-passe. Verifique também o spam.'
      });
    } finally { setBusy(false); }
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!isPasswordAcceptable(newPw)) { setErrorMessage('Palavra-passe demasiado fraca: use pelo menos 10 caracteres com maiúsculas, minúsculas e números, sem sequências, repetições ou palavras comuns.'); return; }
    if (newPw !== newPw2) { setErrorMessage('As palavras-passe não coincidem.'); return; }
    const forced = mode === 'force-password';   // já autenticado: não precisa de captcha
    if (!forced && !captchaToken) { setErrorMessage('Confirme o captcha ("Não sou um robô") antes de guardar.'); return; }
    setBusy(true);
    markLoginBusy(true);
    try {
      if (!forced) resetCaptcha();   // o token é de uso único
      const r = await updateOwnPassword(newPw);
      if (!r.success) { setErrorMessage(r.error || 'Não foi possível alterar.'); return; }
      if (forced) {
        // O servidor limpou a marca (trigger do Auth). Continua o login com a sessão actual.
        loginPasswordRef.current = newPw;   // o lease offline passa a usar a nova palavra-passe
        setNewPw(''); setNewPw2('');
        void showOperationSuccess('Palavra-passe definida!', { details: 'Já pode continuar.' });
        await finishSupabaseLogin();
        return;
      }
      await sbSignOut();   // obriga a entrar já com a nova palavra-passe (e 2FA, se activo)
      setNewPw(''); setNewPw2('');
      if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
      void showOperationSuccess('Palavra-passe alterada com sucesso!', { details: 'Entre com a nova palavra-passe.' });
      setMode('login');
    } finally { markLoginBusy(false); setBusy(false); }
  };

  const resetRegistrationFlow = () => {
    setAdminForm(emptyAdminForm());
    setInstitutionForm(emptyInstitutionForm());
    setAcceptedTerms(false);
    setRegisterError(null);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setRegisterError('A fotografia excede o limite de 10MB.');
      return;
    }
    try {
      const compressed = await compressImageFile(file, 300, 300, 0.82);
      setAdminForm((prev) => ({ ...prev, avatar: compressed }));
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setAdminForm((prev) => ({ ...prev, avatar: reader.result as string }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleContinueToInstitutionStep = (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);

    if (!adminForm.name.trim() || !adminForm.email.trim()) {
      setRegisterError('Por favor, preencha o nome e o e-mail do administrador.');
      return;
    }
    if (!adminForm.password || adminForm.password.trim().length < 10) {
      setRegisterError('A palavra-passe deve ter pelo menos 10 caracteres.');
      return;
    }
    if (!/[a-z]/.test(adminForm.password) || !/[A-Z]/.test(adminForm.password) || !/\d/.test(adminForm.password)) {
      setRegisterError('A palavra-passe deve ter maiúsculas, minúsculas e números.');
      return;
    }
    if (!isPasswordAcceptable(adminForm.password)) {
      setRegisterError('Palavra-passe demasiado fraca. Evite sequências, repetições e palavras comuns; use pelo menos o nível "Normal".');
      return;
    }
    if (adminForm.password !== adminForm.confirmPassword) {
      setRegisterError('As palavras-passe introduzidas não coincidem.');
      return;
    }

    setMode('register-institution');
  };

  const finalizeRegistration = async (skipInstitutionData: boolean) => {
    setRegisterError(null);
    if (!acceptedTerms) {
      setRegisterError('Para registar a instituição tem de aceitar os Termos de Utilização e a Política de Privacidade.');
      return;
    }
    if (!captchaToken) {
      setRegisterError('Confirme o captcha ("Não sou um robô") antes de concluir.');
      return;
    }

    try {
      const result = await runGlobalOperation(
        async () => {
          const res = await dbService.registerInstitutionAndAdmin(
            {
              name: adminForm.name.trim(),
              email: adminForm.email.trim(),
              password: adminForm.password.trim(),
              captchaToken,
              termsAccepted: acceptedTerms,
              termsVersion: TERMS_VERSION,
              username: adminForm.username.trim() || undefined,
              avatar: adminForm.avatar
            },
            skipInstitutionData
              ? {
                  schoolName: 'Nova Instituição',
                  currentAcademicYear: institutionForm.currentAcademicYear.trim() || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`
                }
              : {
                  schoolName: institutionForm.schoolName.trim(),
                  nif: institutionForm.nif.trim(),
                  province: institutionForm.province.trim(),
                  municipality: institutionForm.municipality.trim(),
                  address: institutionForm.address.trim(),
                  phone: institutionForm.phone.trim(),
                  email: institutionForm.email.trim(),
                  currentAcademicYear: institutionForm.currentAcademicYear.trim() || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`
                }
          );
          if (!res.success) {
            throw new Error(res.error || 'Não foi possível concluir o registo da instituição.');
          }
          return res;
        },
        {
          loadingMessage: skipInstitutionData
            ? 'A criar a conta de administrador e a instituição...'
            : 'A criar a conta de administrador e a configurar a instituição...',
          successMessage: 'Conta criada com sucesso!'
        }
      );

      // Pedido enviado: a escola e o administrador só são criados depois de a pessoa abrir o link recebido por e-mail.
      const sentTo = adminForm.email.trim();
      resetRegistrationFlow();
      setErrorMessage(null);
      setRegistrationSentTo(sentTo);
    } catch (err: any) {
      setRegisterError(err?.message || 'Não foi possível concluir o registo. Tente novamente.');
      setCaptchaToken(null);
      setCaptchaKey((k) => k + 1);   // o token do captcha é de uso único
    }
  };

  const handleSubmitInstitutionStep = (e: React.FormEvent) => {
    e.preventDefault();
    finalizeRegistration(false);
  };

  const handleSkipInstitutionStep = () => {
    finalizeRegistration(true);
  };

  return (
    <div className={`lg-root${mode === 'register-admin' || mode === 'register-institution' ? ' lg-expanded' : ''}`} style={LOGIN_BG_STYLE}>
      <div className="lg-shell">
        {/* Esquerda: marca, frase e destaques (textos inalterados) */}
        <div className="lg-left">
          <div>
            <div className="flex items-center gap-4">
              <img
                src="/bandmed-logo.png"
                alt="BandMed"
                className="h-[72px] w-auto shrink-0 select-none"
                draggable={false}
                style={{ filter: 'drop-shadow(0 4px 14px rgba(0,0,0,.35))' }}
              />
              <div className="flex flex-col leading-none">
                <span className="font-headline font-extrabold text-[44px] sm:text-5xl tracking-tight text-white" style={{ textShadow: '0 2px 14px rgba(0,0,0,.35)' }}>BANDMED</span>
                <span className="mt-2 text-[11px] sm:text-xs uppercase tracking-[0.3em] font-medium" style={{ color: '#ffffff', fontWeight: 600, textShadow: '0 1px 3px rgba(2,20,60,.75), 0 0 14px rgba(2,20,60,.6)' }}>
                  Sistema de Gestão Escolar
                </span>
              </div>
            </div>
          </div>

          <div>
            <h1 className="font-headline text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight text-white" style={{ textShadow: '0 3px 24px rgba(0,0,0,.45)' }}>
              {mode === 'login' || mode === 'confirming-registration' || mode === 'registration-done'
                ? <>Gestão Escolar, <span style={{ color: '#38bdf8' }}>Rigor e Transparência.</span></>
                : <>Registe a Sua <span style={{ color: '#38bdf8' }}>Instituição de Ensino.</span></>}
            </h1>

            <div className="lg-features mt-8 space-y-4 max-w-xl">
              <div className="lg-feature">
                <div className="lg-feature-icon" style={{ color: '#fbbf24' }}>
                  <span className="material-symbols-outlined text-[20px]">sync</span>
                </div>
                <div className="flex flex-col text-xs">
                  <span className="font-bold text-white text-[13px]">Sincronização em Tempo Real</span>
                  <span style={{ color: '#d6e4ff' }}>Atualização contínua e instantânea entre secretaria, tesouraria, área pedagógica, coordenação e área ácademica.</span>
                </div>
              </div>
              <div className="lg-feature">
                <div className="lg-feature-icon" style={{ color: '#93c5fd' }}>
                  <span className="material-symbols-outlined text-[20px]">shield</span>
                </div>
                <div className="flex flex-col text-xs">
                  <span className="font-bold text-white text-[13px]">Autenticação Cifrada</span>
                  <span style={{ color: '#d6e4ff' }}>Acesso seguro com encriptação e trilha de auditoria para cada perfil.</span>
                </div>
              </div>
              <div className="lg-feature">
                <div className="lg-feature-icon" style={{ color: '#6ee7b7' }}>
                  <span className="material-symbols-outlined text-[20px]">apartment</span>
                </div>
                <div className="flex flex-col text-xs">
                  <span className="font-bold text-white text-[13px]">Instituição & Isolamento de Dados</span>
                  <span style={{ color: '#d6e4ff' }}>Cada instituição possui a sua própria base de dados</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg-right">
        {/* Right Authentication Panel */}
        <div className="lg-panel">
        <div className="lg-inner">
        <div className="lg-body">
          {mode === 'confirming-registration' && (
            <div className="text-center py-10" role="status" aria-live="polite">
              <Spinner />
              <h2 className="font-headline text-xl font-bold text-slate-900 mt-4">A confirmar o e-mail e a criar a escola...</h2>
              <p className="text-xs text-slate-500 mt-2">Só demora alguns segundos.</p>
            </div>
          )}
          {mode === 'registration-done' && createdSchool && (
            <div className="rounded-xl bg-green-50 border border-green-300 text-green-900 text-center px-5 py-8" role="status" aria-live="polite">
              <span className="material-symbols-outlined text-[52px] text-green-600">check_circle</span>
              <h2 className="font-headline text-2xl font-bold mt-2">Escola criada com sucesso!</h2>
              <p className="text-sm mt-3">
                O e-mail <b>{createdSchool.email}</b> foi confirmado e a escola <b>{createdSchool.name}</b> já está criada, com 30 dias de teste.
              </p>
              <p className="text-sm mt-2">Inicie sessão com o e-mail e a palavra-passe que escolheu no registo.</p>
              <button type="button" autoFocus
                className="mt-6 h-11 px-6 bg-green-700 hover:bg-green-800 text-white font-bold text-sm rounded-lg"
                onClick={() => { setErrorMessage(null); setInfoMessage(null); setMode('login'); }}>
                Iniciar sessão
              </button>
            </div>
          )}
          {mode === 'login' && infoMessage && (
            <div className="mb-4 p-3.5 rounded-xl bg-green-50 border border-green-200 text-green-800 text-xs">{infoMessage}</div>
          )}
          {(mode === 'forgot' || mode === 'mfa' || mode === 'mfa-enroll' || mode === 'new-password' || mode === 'force-password') && (
            <div>
              <h2 className="font-headline text-2xl font-bold text-slate-900">
                {mode === 'forgot' && 'RECUPERAR PALAVRA-PASSE'}
                {mode === 'mfa' && 'VERIFICAÇÃO EM DOIS PASSOS'}
                {mode === 'mfa-enroll' && 'ACTIVAR VERIFICAÇÃO EM DOIS PASSOS'}
                {mode === 'new-password' && 'NOVA PALAVRA-PASSE'}
                {mode === 'force-password' && 'DEFINA A SUA PALAVRA-PASSE'}
              </h2>
              {errorMessage && (
                <Notice tone="error">{errorMessage}</Notice>
              )}
              {infoMessage && (
                <div className="mt-5 p-3.5 rounded-xl bg-green-50 border border-green-200 text-green-800 text-xs">{infoMessage}</div>
              )}

              {mode === 'forgot' && (
                <form onSubmit={submitForgot} className="mt-6 lg-stack">
                  <p className="text-xs text-slate-600">Indique o e-mail da sua conta. Enviaremos um link para definir uma nova palavra-passe.</p>
                  <input type="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="ex: admin@escola.ao" autoComplete="username"
                    className="w-full py-3 px-3 bg-slate-100 rounded-lg text-sm text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]" />
                  <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaKey} />
                  <button type="submit" disabled={busy}
                    className="w-full py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] transition-colors text-sm disabled:opacity-75">
                    {busy ? 'A enviar...' : 'Enviar o Link de Recuperação'}
                  </button>
                  <p className="text-[11px] text-slate-500">Sem acesso ao e-mail? Contacte a Secretaria com o seu documento de identificação ou escreva para <code>bandgestaosupport@gmail.com ou pelo Whatsapp(+244 938 882 190)</code>.</p>
                </form>
              )}

              {(mode === 'mfa' || mode === 'mfa-enroll') && (
                <form onSubmit={submitMfa} className="mt-6 lg-stack">
                  {mode === 'mfa-enroll' && enroll && (
                    <div className="space-y-3 text-xs text-slate-600">
                      <p>O seu perfil exige verificação em dois passos. Leia o QR com o Google Authenticator ou Authy e escreva o código de 6 dígitos.</p>
                      <img src={enroll.qr} alt="QR code para a app autenticadora" width={180} height={180} className="border border-slate-200 rounded-lg" />
                      <p>Não consegue ler? Chave manual: <code className="break-all">{enroll.secret}</code><br />
                        <b>Guarde esta chave num local seguro</b>: se perder o telemóvel, é a sua cópia de segurança.</p>
                    </div>
                  )}
                  {mode === 'mfa' && <p className="text-xs text-slate-600">Introduza o código de 6 dígitos da sua app autenticadora.</p>}
                  <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="one-time-code"
                    maxLength={6} required placeholder="000000"
                    className="w-full py-3 px-3 bg-slate-100 rounded-lg text-center text-lg tracking-[0.5em] font-mono text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]" />
                  <button type="submit" disabled={busy || mfaCode.length !== 6}
                    className="w-full py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] transition-colors text-sm disabled:opacity-60">
                    {busy ? 'A verificar...' : 'Verificar'}
                  </button>
                </form>
              )}

              {(mode === 'new-password' || mode === 'force-password') && (
                <form onSubmit={submitNewPassword} className="mt-6">
                  {mode === 'force-password' && (
                    <Notice tone="warn">
                      {forceReason === 'temporaria'
                        ? 'A palavra-passe que recebeu é temporária. Por segurança, defina agora uma palavra-passe só sua.'
                        : 'A sua palavra-passe expirou. Defina uma nova para continuar.'}
                    </Notice>
                  )}
                  <p className="text-xs text-slate-600 mb-6">Mínimo 10 caracteres, com maiúsculas, minúsculas e números. Evite sequências, repetições e palavras comuns.</p>

                  <div className="lg-field">
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-2" htmlFor="np1">Nova palavra-passe</label>
                    <input id="np1" type="password" required value={newPw} onChange={(e) => setNewPw(e.target.value)} onFocus={() => setNewPwFocus(true)} onBlur={() => setNewPwFocus(false)} placeholder="Nova palavra-passe" autoComplete="new-password"
                      className="w-full py-3 px-3 bg-slate-100 rounded-lg text-sm text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]" />
                    <PasswordStrengthMeter password={newPw} showDetails={newPwFocus} />
                  </div>

                  <div className="lg-field">
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-2" htmlFor="np2">Repita a nova palavra-passe</label>
                    <input id="np2" type="password" required value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Repita a nova palavra-passe" autoComplete="new-password"
                      className="w-full py-3 px-3 bg-slate-100 rounded-lg text-sm text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]"
                      style={newPw2 ? { borderColor: newPw2 === newPw ? '#10b981' : '#ef4444' } : undefined} />
                    {newPw2 && (
                      <p className={`mt-1.5 text-[11px] font-semibold flex items-center gap-1 ${newPw2 === newPw ? 'text-emerald-700' : 'text-red-700'}`}>
                        <span className="material-symbols-outlined text-[14px]">{newPw2 === newPw ? 'check_circle' : 'cancel'}</span>
                        {newPw2 === newPw ? 'As palavras-passe coincidem' : 'As palavras-passe não coincidem'}
                      </p>
                    )}
                  </div>

                  {mode === 'new-password' && (
                    <div className="lg-captcha">
                      <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaKey} />
                    </div>
                  )}

                  <button type="submit" disabled={busy || !isPasswordAcceptable(newPw) || newPw !== newPw2 || (mode === 'new-password' && !captchaToken)}
                    className="w-full py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] transition-colors text-sm disabled:opacity-75">
                    {busy ? 'A guardar...' : 'Guardar nova palavra-passe'}
                  </button>
                </form>
              )}

              {mode === 'force-password' && (
                <button type="button" onClick={() => { void sbSignOut(); setNewPw(''); setNewPw2(''); setErrorMessage(null); setMode('login'); }}
                  className="mt-6 text-xs font-bold text-[#0b1f3a] hover:text-[#7a0c0c] hover:underline">Sair</button>
              )}
              {mode !== 'new-password' && mode !== 'force-password' && (
                <button type="button" onClick={() => { setErrorMessage(null); setInfoMessage(null); setEnroll(null); if (mode !== 'forgot') void sbSignOut(); setMode('login'); }}
                  className="mt-6 text-xs font-bold text-[#0b1f3a] hover:text-[#7a0c0c] hover:underline">Voltar</button>
              )}
            </div>
          )}
          {mode === 'login' && (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-headline text-2xl font-bold text-slate-900">INICIAR SESSÃO</h2>
                  <p className="text-xs text-slate-500 mt-1">
                  </p>
                </div>
              </div>

              {/* Error Message Box */}
              {errorMessage && (
                <Notice
                  tone="error"
                  icon="error"
                  resetKey={unconfirmedEmail ? `unconfirmed-${unconfirmedEmail}-${resendCooldown > 0}` : undefined}
                  actions={unconfirmedEmail ? (
                    <NoticeButton onClick={() => void handleResendConfirmation()} disabled={resendBusy || resendCooldown > 0}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>forward_to_inbox</span>
                      {resendBusy ? 'A enviar…' : resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : 'Reenviar link de confirmação'}
                    </NoticeButton>
                  ) : undefined}
                >
                  <div className="flex-1">
                    <span>{errorMessage}</span>
                  </div>
                </Notice>
              )}
              {resendInfo && !errorMessage && (
                <Notice tone="success" icon="mark_email_read" resetKey={`resent-${resendInfo}`}>{resendInfo}</Notice>
              )}

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1" htmlFor="identifier">
                    E-mail
                  </label>
                  <div className="relative flex items-center bg-slate-100 rounded-lg focus-within:bg-white focus-within:ring-2 focus-within:ring-[#0b1f3a] transition-all">
                    <span className="material-symbols-outlined text-slate-400 pl-3 pr-2 text-[20px] select-none">
                      badge
                    </span>
                    <input
                      id="identifier"
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => {
                        setIdentifier(e.target.value);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="ex: admin@escola.ao"
                      className="w-full py-3 pr-3 bg-transparent text-slate-800 text-sm focus:outline-none"
                      autoComplete="username"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600" htmlFor="password">
                      Palavra-passe
                    </label>
                    <button
                      type="button"
                      onClick={() => { setErrorMessage(null); setInfoMessage(null); setForgotEmail(identifier.includes('@') ? identifier : ''); setMode('forgot'); }}
                      className="text-xs text-[#7a0c0c] hover:underline font-semibold"
                    >
                      Esqueceu a palavra-passe?
                    </button>
                  </div>
                  <div className="relative flex items-center bg-slate-100 rounded-lg focus-within:bg-white focus-within:ring-2 focus-within:ring-[#0b1f3a] transition-all">
                    <span className="material-symbols-outlined text-slate-400 pl-3 pr-2 text-[20px] select-none">
                      lock
                    </span>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="Palavra-passe"
                      className="w-full py-3 pr-10 bg-transparent text-slate-800 text-sm focus:outline-none"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 text-slate-400 hover:text-slate-700"
                      aria-label={showPassword ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between py-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded text-[#0b1f3a] focus:ring-0 accent-[#0b1f3a] cursor-pointer"
                    />
                    <span>          Lembrar-me <span className="text-slate-400"></span></span>
                  </label>
  
                   
                </div>

                <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaKey} />

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] transition-colors duration-200 shadow-md text-sm cursor-pointer disabled:opacity-75 mt-2"
                >
                  {loading ? (
                    <>
                      <Spinner size={16} className="text-white shrink-0" />
                      <span>A verificar...</span>
                    </>
                  ) : (
                    <>
                      <span>Entrar</span>
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-4 border-t border-slate-100 text-center">
                <span className="text-xs text-slate-500">Ainda não tem uma conta? </span>
                <button
                  type="button"
                  onClick={() => {
                    resetRegistrationFlow();
                    setMode('register-admin');
                  }}
                  className="text-xs font-bold text-[#0b1f3a] hover:text-[#7a0c0c] hover:underline"
                >
                                 Registar
                </button>
              </div>
            </div>
          )}

          {mode === 'register-admin' && (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-6 h-6 rounded-full bg-[#0b1f3a] text-white text-[11px] font-bold flex items-center justify-center">1</span>
                    <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">de 2 · Conta de Administrador</span>
                  </div>
                  <h2 className="font-headline text-2xl font-bold text-slate-900">Criar Conta</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Estes dados criam o utilizador com acesso total (Administrador) à nova instituição.
                  </p>
                </div>
              </div>

              {registerError && (
                <Notice tone="error" icon="error">
                  <div className="flex-1">
                    <span>{registerError}</span>
                  </div>
                </Notice>
              )}

              <form onSubmit={handleContinueToInstitutionStep} className="mt-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-slate-200 shrink-0 bg-slate-100">
                    <img src={adminForm.avatar} alt="Avatar" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Fotografia de Perfil (Opcional)
                    </label>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] flex items-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">upload</span>
                      <span>Carregar Foto</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    required
                    value={adminForm.name}
                    onChange={(e) => setAdminForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="ex: Dr. Carlos Mendes"
                    className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      E-mail
                    </label>
                    <input
                      type="email"
                      required
                      value={adminForm.email}
                      onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder="admin@suaescola.pt"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Nome de Utilizador
                    </label>
                    <input
                      type="text"
                      value={adminForm.username}
                      onChange={(e) => setAdminForm((p) => ({ ...p, username: e.target.value }))}
                      placeholder="ex: carlos.mendes"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Palavra-passe
                    </label>
                    <input
                      type="password"
                      required
                      value={adminForm.password}
                      onChange={(e) => setAdminForm((p) => ({ ...p, password: e.target.value }))}
                      onFocus={() => setAdminPwFocus(true)}
                      onBlur={() => setAdminPwFocus(false)}
                      placeholder="Mín. 10 caracteres, A-z e 0-9"
                      autoComplete="new-password"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                    <PasswordStrengthMeter password={adminForm.password} showDetails={adminPwFocus} />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Confirmar Palavra-passe
                    </label>
                    <input
                      type="password"
                      required
                      value={adminForm.confirmPassword}
                      onChange={(e) => setAdminForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                      placeholder="Repita a palavra-passe"
                      autoComplete="new-password"
                      className={`w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 outline-none text-sm transition-all ${
                        adminForm.confirmPassword
                          ? adminForm.confirmPassword === adminForm.password ? 'ring-2 ring-emerald-500' : 'ring-2 ring-red-500'
                          : 'focus:ring-[#0b1f3a]'
                      }`}
                    />
                    {adminForm.confirmPassword && (
                      adminForm.confirmPassword === adminForm.password ? (
                        <p className="mt-1.5 text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">check_circle</span>As palavras-passe coincidem
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[11px] font-semibold text-red-700 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">cancel</span>As palavras-passe não coincidem
                        </p>
                      )
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] transition-colors duration-200 shadow-md text-sm cursor-pointer mt-2"
                >
                  <span>Próximo</span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </button>
              </form>

              <div className="mt-6 pt-4 border-t border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => {
                    resetRegistrationFlow();
                    setMode('login');
                  }}
                  className="text-xs font-bold text-slate-500 hover:text-[#0b1f3a] hover:underline flex items-center gap-1 justify-center w-full"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  <span>Anterior</span>
                </button>
              </div>
            </div>
          )}

          {registrationSentTo && (
            <div className="text-center py-6" role="status">
              <span className="material-symbols-outlined text-[44px] text-[#0b1f3a]">mark_email_read</span>
              <h2 className="font-headline text-2xl font-bold text-slate-900 mt-2">Verifique o seu e-mail</h2>
              <p className="text-sm text-slate-600 mt-2">
                Enviámos um link de confirmação para <b>{registrationSentTo}</b>. A escola e a conta de administrador só são criadas depois de abrir esse link.
              </p>
              {MFA_ENABLED && (
                <p className="text-xs text-slate-600 mt-2">Depois de confirmar, inicie sessão: será pedido para ativar o 2FA (Google Authenticator) antes de entrar.</p>
              )}
              <p className="text-xs text-slate-500 mt-2">Não chegou? Veja a pasta de spam. Pode repetir o registo passado 1 minuto.</p>
              <button type="button" className="mt-4 h-10 px-4 bg-[#0b1f3a] text-white font-bold text-sm" onClick={() => { setRegistrationSentTo(null); setMode('login'); }}>
                Voltar ao início de sessão
              </button>
            </div>
          )}
          {!registrationSentTo && mode === 'register-institution' && (
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-6 h-6 rounded-full bg-[#0b1f3a] text-white text-[11px] font-bold flex items-center justify-center">2</span>
                    <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">de 2 · Dados da Instituição</span>
                  </div>
                  <h2 className="font-headline text-2xl font-bold text-slate-900">Configurar a Instituição</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Pode preencher agora ou saltar este passo e configurar mais tarde em Configurações → Dados da Instituição.
                  </p>
                </div>
              </div>

              {registerError && (
                <Notice tone="error" icon="error">
                  <div className="flex-1">
                    <span>{registerError}</span>
                  </div>
                </Notice>
              )}

              <form onSubmit={handleSubmitInstitutionStep} className="mt-6 space-y-4">
                <div>
                  <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                    Nome da Instituição de Ensino
                  </label>
                  <input
                    type="text"
                    value={institutionForm.schoolName}
                    onChange={(e) => setInstitutionForm((p) => ({ ...p, schoolName: e.target.value }))}
                    placeholder="ex: Complexo Escolar Privado ABC"
                    className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      NIF
                    </label>
                    <input
                      type="text"
                      value={institutionForm.nif}
                      onChange={(e) => setInstitutionForm((p) => ({ ...p, nif: e.target.value }))}
                      placeholder="ex: 5457896525"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Ano Letivo Atual
                    </label>
                    <input
                      type="text"
                      value={institutionForm.currentAcademicYear}
                      onChange={(e) => setInstitutionForm((p) => ({ ...p, currentAcademicYear: e.target.value }))}
                      placeholder="2025/2026"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Província
                    </label>
                    <input
                      type="text"
                      value={institutionForm.province}
                      placeholder="ex: Malanje"
                      onChange={(e) => setInstitutionForm((p) => ({ ...p, province: e.target.value }))}
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Município
                    </label>
                    <input
                      type="text"
                      value={institutionForm.municipality}
                      onChange={(e) => setInstitutionForm((p) => ({ ...p, municipality: e.target.value }))}
                      placeholder="ex: Malanje"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                    Endereço da Sede
                  </label>
                  <input
                    type="text"
                    value={institutionForm.address}
                    onChange={(e) => setInstitutionForm((p) => ({ ...p, address: e.target.value }))}
                    placeholder="ex: Bairro Campo da aviação, Sede de Malanje"
                    className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      Telefone
                    </label>
                    <input
                      type="text"
                      value={institutionForm.phone}
                      onChange={(e) => setInstitutionForm((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="ex: +244 938 882 190"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                      E-mail da Secretaria
                    </label>
                    <input
                      type="email"
                      value={institutionForm.email}
                      onChange={(e) => setInstitutionForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder="ex: secretaria@escolabandmed.com"
                      className="w-full py-2.5 px-3 bg-slate-100 rounded-lg focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] outline-none text-sm transition-all"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer text-xs text-slate-700 leading-relaxed">
                  <input
                    type="checkbox"
                    required
                    checked={acceptedTerms}
                    onChange={(e) => { setAcceptedTerms(e.target.checked); if (e.target.checked) setRegisterError(null); }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#0b1f3a] cursor-pointer"
                  />
                  <span>
                    Li e aceito os{' '}
                    <a href={`${TERMS_URL}#termos`} target="_blank" rel="noopener noreferrer" className="font-bold text-[#0b1f3a] underline hover:text-[#7a0c0c]">Termos de Utilização</a>
                    {' '}e a{' '}
                    <a href={`${TERMS_URL}#privacidade`} target="_blank" rel="noopener noreferrer" className="font-bold text-[#0b1f3a] underline hover:text-[#7a0c0c]">Política de Privacidade</a>
                    , e confirmo que tenho autoridade para registar esta instituição.
                  </span>
                </label>

                <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaKey} />

                <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleSkipInstitutionStep}
                    disabled={!acceptedTerms}
                    className="w-full sm:w-auto flex items-center justify-center gap-1.5 py-3 px-5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors duration-200 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>Pular</span>
                  </button>
                  <button
                    type="submit"
                    disabled={!acceptedTerms}
                    className="w-full flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] transition-colors duration-200 shadow-md text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>Concluir</span>
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 text-center">
                  Se saltar este passo, os dados da instituição, ano letivo, calendário e tabela financeira ficarão vazios até serem configurados em Configurações.
                </p>
              </form>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setMode('register-admin')}
                  className="text-xs font-bold text-slate-500 hover:text-[#0b1f3a] hover:underline flex items-center gap-1 justify-center w-full"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  <span>Anterior</span>
                </button>
              </div>
            </div>
          )}

        </div>
          <div className="mt-8 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
            <div className="flex items-center gap-3">
              <span>© 2026 BandMed</span>
              <span>•</span>
              <span>Ambiente Seguro</span>
            </div>
            <span className="font-mono text-[11px]">Sistema Académico</span>
          </div>
        </div>
        </div>
        </div>
      </div>

      <OperationStatusModal
        isOpen={loginStatus !== 'idle'}
        status={loginStatus === 'loading' ? 'loading' : 'success'}
        loadingMessage="A verificar os dados..."
        successMessage="Bem-vindo!"
      />
    </div>
  );
};
