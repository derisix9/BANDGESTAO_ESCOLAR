import React, { useEffect, useRef, useState } from 'react';
import { LANDING, MODULES, PLATFORM_HERO, PLATFORM_FEATURES } from '../config/landing';
import { fetchPublicPlans, fetchPublicSchools, type PublicPlan, type PublicSchool } from '../services/branches';
import { useColorMode } from '../theme/colorMode';
import { Spinner } from '../components/Spinner';
import '../styles/landing.css';

const Mi: React.FC<{ n: string; className?: string }> = ({ n, className = '' }) => (
  <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{n}</span>
);

const kz = (v: number) => `${new Intl.NumberFormat('pt-AO', { maximumFractionDigits: 0 }).format(v)} Kz`;
const CYCLE: Record<string, string> = { Mensal: '/mês', Trimestral: '/trimestre', Semestral: '/semestre', Anual: '/ano' };
const lim = (v: number | null, one: string, many: (n: number) => string) => (v == null ? `${one} ilimitados` : many(v));

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

const initialModule = (): string | null => {
  try { const m = new URLSearchParams(window.location.search).get('modulo'); return MODULES.some((x) => x.key === m) ? m : null; } catch { return null; }
};

const SchoolCard: React.FC<{ s: PublicSchool }> = ({ s }) => (
  <article className="lp-school">
    <img className="lp-school-logo" src={s.logoUrl || '/school_emblem.png'} alt="" loading="lazy"
         onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/school_emblem.png'; }} />
    <h3 title={s.name}>{s.name}</h3>
    <ul>
      <li><Mi n="person" /><span><small>Administrador</small>{s.admin || '—'}</span></li>
      <li><Mi n="location_on" /><span><small>Província</small>{s.province || '—'}</span></li>
      <li><Mi n="badge" /><span><small>NIF</small>{s.nif || '—'}</span></li>
    </ul>
  </article>
);

export const LandingView: React.FC<{ onEnter: (moduleKey?: string) => void }> = ({ onEnter }) => {
  const { mode, toggle } = useColorMode();
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [moduleKey, setModuleKey] = useState<string | null>(initialModule);
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [plansErr, setPlansErr] = useState(false);
  const [schools, setSchools] = useState<PublicSchool[]>([]);
  const [form, setForm] = useState({ name: '', school: '', phone: '', message: '' });
  const moreRef = useRef<HTMLDivElement>(null);

  const mod = MODULES.find((m) => m.key === moduleKey) ?? null;
  const isEscolar = mod?.key === 'escolar';
  const showPlans = isEscolar;                       // os planos de hoje são os do módulo Escolar
  const hero = mod ? mod.hero : PLATFORM_HERO;
  const heroImage = hero.image;                      // visão geral: imagem BandMed; módulo: a sua imagem (se tiver)
  const footImage = heroImage || PLATFORM_HERO.image; // o rodapé acompanha a imagem de fundo
  const isBanner = !mod;                              // a imagem da visão geral já traz a marca e o lema
  const features = mod ? mod.features : PLATFORM_FEATURES;
  const available = MODULES.filter((m) => m.status === 'available');

  useEffect(() => {
    let alive = true;
    fetchPublicPlans().then((p) => alive && setPlans(p)).catch(() => alive && setPlansErr(true));
    fetchPublicSchools().then((x) => alive && setSchools(x)).catch(() => { /* sem carrossel */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [more]);

  const go = (id: string) => { setMenu(false); setMore(false); scrollTo(id); };

  const chooseModule = (key: string | null) => {
    setModuleKey(key); setMore(false); setMenu(false);
    try {
      const url = new URL(window.location.href);
      if (key) url.searchParams.set('modulo', key); else url.searchParams.delete('modulo');
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignora */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // «Começar Grátis»: com um único módulo disponível vai direto a ele; com vários, mostra a área dos módulos.
  const startFree = () => {
    setMenu(false);
    if (available.length === 1) onEnter(available[0].key); else go('modulos');
  };

  const notify = (m: { name: string }) => {
    setForm((f) => ({ ...f, message: `Gostaria de ser avisado quando o módulo ${m.name} estiver disponível.` }));
    go('contactos');
  };
  const choosePlan = (p: PublicPlan) => {
    setForm((f) => ({ ...f, message: `Olá! Tenho interesse no plano ${p.name} (${kz(p.priceKz)}${CYCLE[p.cycle] ?? ''}).` }));
    go('contactos');
  };

  const body = () => `Nome: ${form.name}\nEscola/Instituição: ${form.school}\nTelefone: ${form.phone}\n\n${form.message}`;
  const waHref = `https://wa.me/${LANDING.contacts.whatsapp}?text=${encodeURIComponent(body())}`;
  const mailHref = `mailto:${LANDING.contacts.email}?subject=${encodeURIComponent('Contacto — ' + LANDING.brand)}&body=${encodeURIComponent(body())}`;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const popular = plans && plans.length >= 3 ? Math.floor(plans.length / 2) : -1;
  const loopSchools = schools.length >= 4;           // poucas escolas: lista centrada, sem rolagem

  return (
    <div className="lp" style={{ ['--foot-img' as string]: `url('${footImage}')` }}>
      {/* ===== Cabeçalho ===== */}
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <button className="lp-brand" onClick={() => chooseModule(null)} aria-label="Início">
            <img src="/icon-192.png" alt="" className="lp-logo" />
            <span><b>{LANDING.brand.toUpperCase()}</b><small>{LANDING.tagline}</small></span>
          </button>
          <nav className={`lp-links ${menu ? 'open' : ''}`}>
            <a onClick={() => go('modulos')}>Módulos</a>
            <a onClick={() => go('recursos')}>Recursos</a>
            {showPlans && <a onClick={() => go('planos')}>Planos e preços</a>}
            <a onClick={() => go('contactos')}>Contactos</a>
            <div className="lp-more" ref={moreRef}>
              <button type="button" className={`lp-more-btn ${more ? 'open' : ''}`} onClick={() => setMore((v) => !v)} aria-haspopup="true" aria-expanded={more}>
                Mais<Mi n="expand_more" />
              </button>
              {more && (
                <div className="lp-more-menu" role="menu">
                  <button role="menuitem" className={!mod ? 'on' : ''} onClick={() => chooseModule(null)}>
                    <span className="lp-ico sm"><Mi n="apps" /></span><span><b>Visão geral</b><small>Todos os módulos</small></span>
                  </button>
                  {MODULES.map((m) => (
                    <button role="menuitem" key={m.key} className={mod?.key === m.key ? 'on' : ''} onClick={() => chooseModule(m.key)}>
                      <span className="lp-ico sm"><Mi n={m.icon} /></span>
                      <span><b>{m.name}</b><small>{m.status === 'available' ? 'Disponível' : 'Em breve'}</small></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
          <div className="lp-nav-act">
            <button className="lp-icon" onClick={toggle} title={mode === 'dark' ? 'Modo claro' : 'Modo escuro'} aria-label="Alternar modo escuro">
              <Mi n={mode === 'dark' ? 'light_mode' : 'dark_mode'} />
            </button>
            <button className="lp-btn lp-btn-green" onClick={startFree}>Começar Grátis<Mi n="arrow_outward" /></button>
            <button className="lp-icon lp-burger" onClick={() => setMenu((m) => !m)} aria-label="Menu"><Mi n={menu ? 'close' : 'menu'} /></button>
          </div>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className={`lp-hero ${heroImage ? 'has-img' : ''} ${isBanner ? 'is-banner' : ''}`} style={heroImage ? { ['--hero-img' as string]: `url('${heroImage}')` } : undefined}>
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-text">
            <span className="lp-pill"><Mi n="verified" />{hero.pill}</span>
            <h1>{hero.title.split('\n').map((l, i) => <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>)}</h1>
            <p className="lp-hero-p">{hero.text}</p>
            <div className="lp-cta">
              {!mod || mod.status === 'available'
                ? <button className="lp-btn lp-btn-green lp-btn-lg" onClick={() => (mod ? onEnter(mod.key) : startFree())}><Mi n="login" />{mod ? 'Entrar no sistema' : 'Começar Grátis'}</button>
                : <button className="lp-btn lp-btn-green lp-btn-lg" onClick={() => notify(mod)}><Mi n="notifications" />Quero ser avisado</button>}
              {showPlans
                ? <button className="lp-btn lp-btn-amber lp-btn-lg" onClick={() => go('planos')}>Ver planos e preços</button>
                : <button className="lp-btn lp-btn-amber lp-btn-lg" onClick={() => go('modulos')}>Ver módulos</button>}
            </div>
            <ul className="lp-badges">
              {hero.badges.map((b) => <li key={b.text}><Mi n={b.icon} />{b.text}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* ===== Escolas registadas (só no módulo Escolar) ===== */}
      {isEscolar && schools.length > 0 && (
        <section id="escolas" className="lp-sec lp-schools-sec">
          <div className="lp-wrap">
            <p className="lp-kicker">Escolas na plataforma</p>
            <h2>Quem já usa o BandMed Escolar</h2>
            <p className="lp-sub">Instituições registadas e ativas no sistema.</p>
          </div>
          <div className={`lp-carousel ${loopSchools ? 'is-loop' : 'is-static'}`}>
            <div className="lp-track" style={loopSchools ? { animationDuration: `${Math.max(24, schools.length * 6)}s` } : undefined}>
              {schools.map((sc) => <SchoolCard key={sc.id} s={sc} />)}
              {loopSchools && schools.map((sc) => <SchoolCard key={`d-${sc.id}`} s={sc} />)}
            </div>
          </div>
        </section>
      )}

      {/* ===== Módulos ===== */}
      <section id="modulos" className="lp-sec">
        <div className="lp-wrap">
          <p className="lp-kicker">Módulos</p>
          <h2>Uma plataforma, vários setores</h2>
          <p className="lp-sub">Hoje o módulo Escolar está disponível. Outros setores estão a caminho.</p>
          <div className="lp-grid lp-grid-3">
            {MODULES.map((m) => (
              <article key={m.key} className={`lp-card lp-module ${m.status === 'soon' ? 'is-soon' : ''} ${mod?.key === m.key ? 'is-sel' : ''}`}>
                <div className="lp-module-top">
                  <span className="lp-ico"><Mi n={m.icon} /></span>
                  <span className={`lp-tag ${m.status === 'available' ? 'ok' : 'soon'}`}>{m.status === 'available' ? 'Disponível' : 'Em breve'}</span>
                </div>
                <h3>{m.name}</h3>
                <p>{m.description}</p>
                <ul className="lp-list">{m.points.map((t) => <li key={t}><Mi n="check_circle" />{t}</li>)}</ul>
                <div className="lp-module-act">
                  {m.status === 'available'
                    ? <button className="lp-btn lp-btn-blue" onClick={() => onEnter(m.key)}><Mi n="login" />Entrar</button>
                    : <button className="lp-btn lp-btn-teal" onClick={() => notify(m)}><Mi n="notifications" />Quero ser avisado</button>}
                  <button className="lp-btn lp-btn-amber" onClick={() => chooseModule(m.key)}>Ver detalhes</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Recursos ===== */}
      <section id="recursos" className="lp-sec lp-alt">
        <div className="lp-wrap">
          <p className="lp-kicker">Recursos</p>
          <h2>{mod ? mod.featuresTitle : 'Tudo o que a sua instituição precisa'}</h2>
          <p className="lp-sub">{mod ? mod.featuresSub : 'Recursos comuns a todos os módulos da plataforma.'}</p>
          <div className="lp-grid lp-grid-4">
            {features.map((f) => (
              <article key={f.title} className="lp-card lp-feat">
                <span className="lp-ico sm"><Mi n={f.icon} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Planos (módulo Escolar) ===== */}
      {showPlans && (
      <section id="planos" className="lp-sec">
        <div className="lp-wrap">
          <p className="lp-kicker">Planos e preços</p>
          <h2>Escolha o plano da sua instituição</h2>
          <p className="lp-sub">O plano é único para a escola mãe e as filiais: alunos, utilizadores e armazenamento somam-se.</p>

          {!plans && !plansErr && <div className="lp-state"><Spinner size={44} /><span>A carregar planos…</span></div>}
          {plansErr && (
            <div className="lp-state"><Mi n="info" /><span>Não foi possível carregar os planos agora. Contacte-nos para receber a tabela de preços.</span>
              <button className="lp-btn lp-btn-blue" onClick={() => go('contactos')}>Falar connosco</button></div>
          )}
          {plans && plans.length === 0 && (
            <div className="lp-state"><Mi n="sell" /><span>Os planos serão publicados em breve. Contacte-nos para uma proposta.</span>
              <button className="lp-btn lp-btn-blue" onClick={() => go('contactos')}>Pedir proposta</button></div>
          )}
          {plans && plans.length > 0 && (
            <div className="lp-grid lp-plans">
              {plans.map((p, i) => {
                const items = (p.description ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
                return (
                  <article key={p.id} className={`lp-card lp-plan ${i === popular ? 'is-pop' : ''}`}>
                    {i === popular && <span className="lp-pop">Mais escolhido</span>}
                    <h3>{p.name}</h3>
                    <div className="lp-price"><b>{p.priceKz > 0 ? kz(p.priceKz) : 'Grátis'}</b>{p.priceKz > 0 && <small>{CYCLE[p.cycle] ?? ''}</small>}</div>
                    {p.trialDays > 0 && <p className="lp-trial"><Mi n="redeem" />{p.trialDays} dias de teste grátis</p>}
                    <ul className="lp-list">
                      <li><Mi n="school" />{lim(p.maxStudents, 'Alunos', (n) => `Até ${new Intl.NumberFormat('pt-AO').format(n)} alunos`)}</li>
                      <li><Mi n="manage_accounts" />{lim(p.maxUsers, 'Utilizadores', (n) => `Até ${new Intl.NumberFormat('pt-AO').format(n)} utilizadores`)}</li>
                      <li><Mi n="cloud" />{p.storageGb == null ? 'Armazenamento ilimitado' : `${p.storageGb} GB de armazenamento`}</li>
                      <li><Mi n="account_tree" />Escola mãe e filiais</li>
                      {items.map((t) => <li key={t}><Mi n="check_circle" />{t}</li>)}
                    </ul>
                    <button className={`lp-btn ${i === popular ? 'lp-btn-green' : 'lp-btn-blue'}`} onClick={() => choosePlan(p)}>
                      {p.trialDays > 0 ? 'Começar teste grátis' : 'Contratar'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
      )}

      {/* ===== Contactos ===== */}
      <section id="contactos" className={`lp-sec ${showPlans ? 'lp-alt' : ''}`}>
        <div className="lp-wrap">
          <p className="lp-kicker">Contactos</p>
          <h2>Fale com a nossa equipa</h2>
          <p className="lp-sub">Peça uma demonstração, tire dúvidas ou solicite uma proposta.</p>
          <div className="lp-contact">
            <div className="lp-info">
              <a className="lp-card lp-row" href={`tel:${LANDING.contacts.phone.replace(/\s/g, '')}`}><span className="lp-ico sm"><Mi n="call" /></span><span><small>Telefone</small><b>{LANDING.contacts.phone}</b></span></a>
              <a className="lp-card lp-row" href={`https://wa.me/${LANDING.contacts.whatsapp}`} target="_blank" rel="noreferrer"><span className="lp-ico sm"><Mi n="chat" /></span><span><small>WhatsApp</small><b>Conversar agora</b></span></a>
              <a className="lp-card lp-row" href={`mailto:${LANDING.contacts.email}`}><span className="lp-ico sm"><Mi n="mail" /></span><span><small>E-mail</small><b>{LANDING.contacts.email}</b></span></a>
              <div className="lp-card lp-row"><span className="lp-ico sm"><Mi n="location_on" /></span><span><small>Localização</small><b>{LANDING.contacts.address}</b></span></div>
              <div className="lp-card lp-row"><span className="lp-ico sm"><Mi n="schedule" /></span><span><small>Horário</small><b>{LANDING.contacts.hours}</b></span></div>
            </div>
            <div className="lp-card lp-form">
              <h3>Envie-nos uma mensagem</h3>
              <div className="lp-fields">
                <label>Nome<input value={form.name} onChange={set('name')} placeholder="O seu nome" /></label>
                <label>Escola / Instituição<input value={form.school} onChange={set('school')} placeholder="Nome da instituição" /></label>
                <label className="full">Telefone<input value={form.phone} onChange={set('phone')} placeholder="9xx xxx xxx" inputMode="tel" /></label>
                <label className="full">Mensagem<textarea rows={4} value={form.message} onChange={set('message')} placeholder="Como podemos ajudar?" /></label>
              </div>
              <div className="lp-form-act">
                <a className="lp-btn lp-btn-green" href={waHref} target="_blank" rel="noreferrer"><Mi n="chat" />Enviar por WhatsApp</a>
                <a className="lp-btn lp-btn-blue" href={mailHref}><Mi n="mail" />Enviar por e-mail</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Rodapé ===== */}
      <footer className="lp-foot">
        <div className="lp-wrap">
          <div className="lp-foot-cols">
            <div className="lp-foot-brand">
              <div className="lp-brand static"><img src="/icon-192.png" alt="" className="lp-logo" /><span><b>{LANDING.brand.toUpperCase()}</b></span></div>
              <p>Plataforma de gestão para vários setores, feita para Angola. Funciona no computador e no telemóvel.</p>
            </div>
            <div>
              <h4>Módulos</h4>
              {MODULES.map((m) => <a key={m.key} onClick={() => chooseModule(m.key)}>{m.name}</a>)}
            </div>
            <div>
              <h4>Plataforma</h4>
              <a onClick={() => go('modulos')}>Módulos</a>
              <a onClick={() => go('recursos')}>Recursos</a>
              {showPlans && <a onClick={() => go('planos')}>Planos e preços</a>}
              <a onClick={startFree}>Começar Grátis</a>
            </div>
            <div>
              <h4>Contactos</h4>
              <a href={`tel:${LANDING.contacts.phone.replace(/\s/g, '')}`}><Mi n="call" />{LANDING.contacts.phone}</a>
              <a href={`https://wa.me/${LANDING.contacts.whatsapp}`} target="_blank" rel="noreferrer"><Mi n="chat" />WhatsApp</a>
              <a href={`mailto:${LANDING.contacts.email}`}><Mi n="mail" />{LANDING.contacts.email}</a>
              <span><Mi n="location_on" />{LANDING.contacts.address}</span>
              <span><Mi n="schedule" />{LANDING.contacts.hours}</span>
            </div>
          </div>

          <div className="lp-foot-band">
            <div className="lp-foot-img" role="img" aria-label="" />
            <h3>Gestão Inteligente<br />para sua Empresa</h3>
            <div className="lp-foot-cta">
              <p>Fale connosco e peça uma demonstração, sem compromisso.</p>
              <button className="lp-btn lp-btn-blue" onClick={() => go('contactos')}><Mi n="mail" />Falar com a equipa</button>
            </div>
          </div>

          <div className="lp-foot-bottom">
            <span>© {new Date().getFullYear()} {LANDING.brand}. Todos os direitos reservados.</span>
            <a href={LANDING.legalUrl} target="_blank" rel="noreferrer">Termos e privacidade</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingView;
