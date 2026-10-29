/**
 * Conteúdo da página principal (site público). Edite aqui os contactos, módulos e recursos.
 * Os PLANOS e PREÇOS vêm da base de dados (Admin Master → Planos), não daqui.
 */
export const LANDING = {
  brand: 'BandMed',
  tagline: 'Sistema de Gestão',
  // >>> SUBSTITUA pelos contactos reais <<<
  contacts: {
    phone: '+244 938 882 190',
    whatsapp: '244938882190', // só dígitos, com indicativo do país
    email: 'bandgestaosupport@gmail.com',
    address: 'Luanda, Angola',
    hours: 'Segunda a Quinta · 08:30 – 17:30',
  },
  legalUrl: '/termos-e-privacidade.html',
};

export type ModuleStatus = 'available' | 'soon';
export interface LandingFeature { icon: string; title: string; text: string }
export interface LandingModule {
  key: string; name: string; icon: string; status: ModuleStatus; description: string; points: string[];
  /** Conteúdo da página principal quando este módulo é escolhido no menu «Mais». */
  hero: { pill: string; title: string; text: string; badges: { icon: string; text: string }[]; image?: string };
  features: LandingFeature[]; featuresTitle: string; featuresSub: string;
}

/** Visão geral (nenhum módulo escolhido): não deve parecer que a plataforma é só de gestão escolar. */
export const PLATFORM_HERO = {
  image: '/bandmed-hero.jpg',
  pill: 'Plataforma feita para Angola',
  title: 'Uma plataforma de gestão para vários setores.',
  text: 'Escolas, clínicas, centros de formação e mais. Escolha o módulo do seu setor e comece a gerir no computador e no telemóvel.',
  badges: [
    { icon: 'widgets', text: 'Vários módulos' },
    { icon: 'smartphone', text: 'Funciona no telemóvel' },
    { icon: 'lock', text: 'Dados protegidos' },
  ],
};

export const MODULES: LandingModule[] = [
  { key: 'escolar', name: 'BandMed Escolar', icon: 'school', status: 'available',
    description: 'Gestão completa de escolas: da matrícula à pauta, da tesouraria ao portal do professor.',
    points: ['Secretaria, matrículas e pré-matrícula online', 'Pedagógico: turmas, notas, pautas e horários', 'Tesouraria, propinas e folha de pagamento', 'Escola mãe com filiais num único plano'],
    hero: { pill: 'BandMed Escolar', title: 'Gestão escolar completa,\nnuma só plataforma.',
      text: 'Matrículas, notas, propinas, recursos humanos e muito mais. Uma escola mãe e todas as suas filiais num único plano, no computador e no telemóvel.',
      badges: [{ icon: 'account_tree', text: 'Escola mãe e filiais' }, { icon: 'smartphone', text: 'Funciona no telemóvel' }, { icon: 'lock', text: 'Dados protegidos' }],
      image: '/prematricula-hero.jpg' },
    featuresTitle: 'Tudo o que a sua escola precisa', featuresSub: 'Áreas integradas entre si: um registo feito numa área aparece nas outras.',
    features: [] /* preenchido abaixo com FEATURES */ },
  { key: 'hospitalar', name: 'BandMed Hospitalar', icon: 'local_hospital', status: 'soon',
    description: 'Gestão de clínicas e hospitais: pacientes, consultas, farmácia e faturação.',
    points: ['Ficha e processo clínico do paciente', 'Marcação de consultas e agenda', 'Farmácia, stock e faturação'],
    hero: { pill: 'BandMed Hospitalar · Em breve', title: 'Gestão de clínicas e hospitais,\nnuma só plataforma.',
      text: 'Pacientes, consultas, farmácia e faturação integrados. O módulo está em preparação: registe o seu interesse e seja dos primeiros a ser avisado.',
      badges: [{ icon: 'medical_services', text: 'Processo clínico' }, { icon: 'smartphone', text: 'Funciona no telemóvel' }, { icon: 'lock', text: 'Dados protegidos' }] },
    featuresTitle: 'O que vai ter o BandMed Hospitalar', featuresSub: 'Áreas previstas para este módulo. Diga-nos o que é mais importante para si.',
    features: [
      { icon: 'personal_injury', title: 'Pacientes', text: 'Ficha e processo clínico do paciente, sempre acessível à equipa autorizada.' },
      { icon: 'event_available', title: 'Consultas e agenda', text: 'Marcação de consultas, agenda por médico e lembretes aos pacientes.' },
      { icon: 'medication', title: 'Farmácia e stock', text: 'Controlo de medicamentos, consumíveis e alertas de stock mínimo.' },
      { icon: 'receipt_long', title: 'Faturação', text: 'Faturas, recibos e contas correntes de pacientes e seguradoras.' },
      { icon: 'monitoring', title: 'Relatórios', text: 'Indicadores de atendimento, receitas e ocupação da unidade.' },
      { icon: 'cloud_sync', title: 'Cópias de segurança', text: 'Dados protegidos, com cópias de segurança e perfis de acesso.' },
    ] },
  { key: 'mais', name: 'Mais módulos', icon: 'widgets', status: 'soon',
    description: 'A plataforma cresce para outras áreas. Diga-nos o que precisa e ajudamos a priorizar.',
    points: ['Formação profissional e centros de estudo', 'Gestão administrativa e RH', 'Outros setores, a pedido'],
    hero: { pill: 'Novos módulos · Em breve', title: 'A plataforma cresce\nconsigo.',
      text: 'Formação profissional, centros de estudo, gestão administrativa e outros setores. Diga-nos o que precisa e ajudamos a priorizar.',
      badges: [{ icon: 'widgets', text: 'Módulos a pedido' }, { icon: 'smartphone', text: 'Funciona no telemóvel' }, { icon: 'lock', text: 'Dados protegidos' }] },
    featuresTitle: 'Áreas em estudo', featuresSub: 'Setores que a plataforma pode vir a cobrir.',
    features: [
      { icon: 'school', title: 'Formação profissional', text: 'Cursos, turmas, certificados e pagamentos de formandos.' },
      { icon: 'local_library', title: 'Centros de estudo', text: 'Inscrições, horários, explicadores e mensalidades.' },
      { icon: 'badge', title: 'Gestão administrativa e RH', text: 'Funcionários, contratos, assiduidade e folha de pagamento.' },
      { icon: 'support_agent', title: 'Outros setores', text: 'Conte-nos o seu caso e avaliamos um módulo à medida.' },
    ] },
];

/** Recursos mostrados na visão geral da plataforma (comuns a todos os módulos). */
export const PLATFORM_FEATURES: LandingFeature[] = [
  { icon: 'widgets', title: 'Vários módulos', text: 'Escolar já disponível; Hospitalar e outros setores a caminho, na mesma plataforma.' },
  { icon: 'account_tree', title: 'Grupo e filiais', text: 'Uma instituição mãe e todas as suas filiais num único plano.' },
  { icon: 'smartphone', title: 'Qualquer dispositivo', text: 'Funciona no computador e no telemóvel, com modo claro e escuro.' },
  { icon: 'qr_code_2', title: 'Cartões e QR Code', text: 'Cartões e crachás com validação pública por QR Code.' },
  { icon: 'monitoring', title: 'Relatórios', text: 'Indicadores do grupo e de cada unidade num só painel.' },
  { icon: 'cloud_sync', title: 'Cópias de segurança', text: 'Backups da instituição e perfis de acesso por utilizador.' },
  { icon: 'lock', title: 'Dados protegidos', text: 'Acessos por perfil, registo de atividade e proteção de dados.' },
  { icon: 'campaign', title: 'Comunicação', text: 'Avisos e notificações para a sua equipa e clientes.' },
];

export const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: 'badge', title: 'Secretaria', text: 'Matrículas, processos de alunos, declarações, cartões de estudante e pré-matrícula online.' },
  { icon: 'menu_book', title: 'Pedagógico', text: 'Turmas, disciplinas, horários, avaliações, regras de notas e pautas prontas a imprimir.' },
  { icon: 'payments', title: 'Tesouraria', text: 'Tabela financeira, propinas, pagamentos, recibos, despesas e saldo da instituição.' },
  { icon: 'groups', title: 'Recursos Humanos', text: 'Docentes e funcionários, contratos, assiduidade e folha de pagamento.' },
  { icon: 'inventory_2', title: 'Logística', text: 'Transporte escolar, inventário e requisições, tudo organizado por escola.' },
  { icon: 'health_and_safety', title: 'Saúde & Segurança', text: 'Ficha de saúde dos alunos, ocorrências e registos de segurança.' },
  { icon: 'campaign', title: 'Comunicação', text: 'Avisos, notificações e contacto com encarregados de educação.' },
  { icon: 'monitoring', title: 'Relatórios', text: 'Indicadores do grupo e de cada escola: alunos, assiduidade, cobrança e despesas.' },
  { icon: 'account_tree', title: 'Escola mãe e filiais', text: 'Um único plano para o grupo, com consumo somado e painel para escolher a escola.' },
  { icon: 'qr_code_2', title: 'Cartões e QR Code', text: 'Cartões de estudante e crachás com validação pública por QR Code.' },
  { icon: 'cloud_sync', title: 'Cópias de segurança', text: 'Backups da instituição e perfis de acesso por utilizador.' },
  { icon: 'dark_mode', title: 'Qualquer dispositivo', text: 'Funciona no computador e no telemóvel, com modo claro e escuro.' },
];

MODULES.find((m) => m.key === 'escolar')!.features = FEATURES;
