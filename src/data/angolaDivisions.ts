/**
 * Divisão Político-Administrativa oficial da República de Angola.
 *
 * Fonte: Lei n.º 14/24, de 5 de Setembro (Lei da Divisão Político-Administrativa),
 * em vigor desde 1 de Janeiro de 2025 — 21 Províncias, 326 Municípios, 378 Comunas —
 * dados publicados pelo Ministério da Administração do Território (MAT):
 * https://mat.gov.ao/web/mapa-de-angola
 *
 * Estrutura: Província → Municípios → Comunas.
 * Um município sem comunas próprias (a fonte oficial regista "Sem Comunas")
 * aparece aqui com uma única "comuna" igual ao nome do próprio município,
 * para que o 3.º selector (Comuna) tenha sempre pelo menos uma opção válida.
 */

export interface AngolaMunicipality {
  name: string;
  communes: string[];
}

export interface AngolaProvince {
  name: string;
  capital: string;
  municipalities: AngolaMunicipality[];
}

export const ANGOLA_DIVISIONS: AngolaProvince[] = [
  {
    name: 'Bengo',
    capital: 'Dande',
    municipalities: [
      { name: 'Bula Atumba', communes: ['Bula Atumba', 'Quiage'] },
      { name: 'Dande', communes: ['Caxito', 'Mabubas', 'Quicabo'] },
      { name: 'Quibaxe', communes: ['Coxe', 'Paredes', 'Quibaxe'] },
      { name: 'Nambuangongo', communes: ['Canacassala', 'Gombe', 'Zala'] },
      { name: 'Pango Aluquém', communes: ['Pango Aluquém', 'Cazuangongo'] },
      { name: 'Ambriz', communes: ['Ambriz', 'Bela Vista', 'Tabi'] },
      { name: 'Muxaluando', communes: ['Muxaluando', 'Quixico', 'Cage Mazumbo'] },
      { name: 'Piri', communes: ['Piri'] },
      { name: 'Quicunzo', communes: ['Quicunzo'] },
      { name: 'Úcua', communes: ['Úcua'] },
      { name: 'Panguila', communes: ['Panguila'] },
      { name: 'Barra do Dande', communes: ['Barra do Dande'] }
    ]
  },
  {
    name: 'Benguela',
    capital: 'Benguela',
    municipalities: [
      { name: 'Baía Farta', communes: ['Baía Farta'] },
      { name: 'Balombo', communes: ['Balombo', 'Maca Mombolo'] },
      { name: 'Bocoio', communes: ['Bocoio', 'Cubal do Lumbo', 'Monte Belo'] },
      { name: 'Caimbambo', communes: ['Caimbambo', 'Caiave', 'Viangombe'] },
      { name: 'Catumbela', communes: ['Catumbela'] },
      { name: 'Chongorói', communes: ['Chongorói', 'Camuine'] },
      { name: 'Cubal', communes: ['Cubal'] },
      { name: 'Ganda', communes: ['Ganda'] },
      { name: 'Lobito', communes: ['Lobito'] },
      { name: 'Benguela', communes: ['Benguela'] },
      { name: 'Egito Praia', communes: ['Egito Praia', 'Canjala'] },
      { name: 'Chindumbo', communes: ['Chindumbo'] },
      { name: 'Dombe Grande', communes: ['Dombe Grande'] },
      { name: 'Capupa', communes: ['Capupa'] },
      { name: 'Biópio', communes: ['Biópio'] },
      { name: 'Chila', communes: ['Chila'] },
      { name: 'Chicuma', communes: ['Chicuma'] },
      { name: 'Babaera', communes: ['Babaera'] },
      { name: 'Iambala', communes: ['Iambala'] },
      { name: 'Catengue', communes: ['Catengue'] },
      { name: 'Bolonguera', communes: ['Bolonguera'] },
      { name: 'Canhamela', communes: ['Canhamela'] },
      { name: 'Navegantes', communes: ['Navegantes'] }
    ]
  },
  {
    name: 'Bié',
    capital: 'Cuíto',
    municipalities: [
      { name: 'Andulo', communes: ['Andulo', 'Cassumbe', 'Chivaúlo'] },
      { name: 'Camacupa', communes: ['Camacupa', 'Cuanza', 'Muinha'] },
      { name: 'Catabola', communes: ['Catabola', 'Caiuera', 'Sande'] },
      { name: 'Chinguar', communes: ['Chinguar', 'Cutato', 'Cangote'] },
      { name: 'Chitembo', communes: ['Chitembo', 'Cachingues', 'Malengue'] },
      { name: 'Cuemba', communes: ['Cuemba', 'Munhango', 'Sachinemuna'] },
      { name: 'Cuíto', communes: ['Cuíto', 'Cunje'] },
      { name: 'Cunhinga', communes: ['Cunhinga'] },
      { name: 'Nharêa', communes: ['Nharêa', 'Gamba', 'Caieie'] },
      { name: 'Luando', communes: ['Luando'] },
      { name: 'Ringoma', communes: ['Ringoma'] },
      { name: 'Mumbué', communes: ['Mumbué', 'Mutumbo', 'Soma Cuanza'] },
      { name: 'Calucinga', communes: ['Calucinga'] },
      { name: 'Chicala', communes: ['Chicala'] },
      { name: 'Chipeta', communes: ['Chipeta', 'Chiuca'] },
      { name: 'Umpulo', communes: ['Umpulo'] },
      { name: 'Lúbia', communes: ['Lúbia', 'Dando'] },
      { name: 'Cambândua', communes: ['Cambândua'] },
      { name: 'Belo Horizonte', communes: ['Belo Horizonte'] }
    ]
  },
  {
    name: 'Cabinda',
    capital: 'Cabinda',
    municipalities: [
      { name: 'Belize', communes: ['Luali', 'Belize'] },
      { name: 'Buco-Zau', communes: ['Buco-Zau'] },
      { name: 'Cabinda', communes: ['Cabinda'] },
      { name: 'Cacongo', communes: ['Dinge', 'Lândana'] },
      { name: 'Miconje', communes: ['Miconje'] },
      { name: 'Massabi', communes: ['Massabi'] },
      { name: 'Necuto', communes: ['Necuto', 'Inhuca'] },
      { name: 'Tando Zinze', communes: ['Tando Zinze', 'Malembo'] },
      { name: 'Liambo', communes: ['Liambo'] },
      { name: 'Ngoio', communes: ['Ngoio'] }
    ]
  },
  {
    name: 'Cuando',
    capital: 'Mavinga',
    municipalities: [
      { name: 'Cuito Cuanavale', communes: ['Cuito Cuanavale', 'Lupire'] },
      { name: 'Dirico', communes: ['Dirico', 'Xamavera'] },
      { name: 'Mavinga', communes: ['Mavinga'] },
      { name: 'Rivungo', communes: ['Rivungo'] },
      { name: 'Xipundo', communes: ['Xipundo'] },
      { name: 'Dima', communes: ['Cunjamba', 'Cutuile'] },
      { name: 'Luiana', communes: ['Luiana'] },
      { name: 'Mucusso', communes: ['Mucusso'] },
      { name: 'Luengue', communes: ['Luengue'] }
    ]
  },
  {
    name: 'Cuanza-Norte',
    capital: 'Cazengo',
    municipalities: [
      { name: 'Ambaca', communes: ['Camabatela', 'Máua', 'Bindo'] },
      { name: 'Banga', communes: ['Banga', 'Cariamba'] },
      { name: 'Bolongongo', communes: ['Bolongongo'] },
      { name: 'Cambambe', communes: ['Dondo', 'Dange ya Menha', 'São Pedro da Quilemba'] },
      { name: 'Cazengo', communes: ['Caculo Camuiza', 'Ndalatando'] },
      { name: 'Golungo Alto', communes: ['Golungo Alto', 'Cambondo', 'Quilombo quía Puto'] },
      { name: 'Lucala', communes: ['Lucala', 'Quiangombe'] },
      { name: 'Ngonguembo', communes: ['Quilombo dos Dembos', 'Camame', 'Cavunga'] },
      { name: 'Quiculungo', communes: ['Quiculungo'] },
      { name: 'Samba Cajú', communes: ['Samba Cajú', 'Samba Lucala'] },
      { name: 'Massangano', communes: ['Massangano', 'Zenza do Itombe'] },
      { name: 'Cêrca', communes: ['Cêrca'] },
      { name: 'Tango', communes: ['Tango'] },
      { name: 'Terreiro', communes: ['Terreiro', 'Quiquiemba'] },
      { name: 'Aldeia Nova', communes: ['Aldeia Nova'] },
      { name: 'Caculo Cabaça', communes: ['Caculo Cabaça'] },
      { name: 'Luinga', communes: ['Luinga'] }
    ]
  },
  {
    name: 'Cuanza-Sul',
    capital: 'Sumbe',
    municipalities: [
      { name: 'Gabela', communes: ['Gabela', 'Assango'] },
      { name: 'Cassongue', communes: ['Cassongue', 'Atóme', 'Dumbi'] },
      { name: 'Waku Kungo', communes: ['Waku Kungo'] },
      { name: 'Conda', communes: ['Cunjo', 'Conda'] },
      { name: 'Ebo', communes: ['Ebo', 'Cassanje'] },
      { name: 'Calulo', communes: ['Calulo', 'Cabuta'] },
      { name: 'Mussende', communes: ['Mussende', 'Quipaxi'] },
      { name: 'Porto Amboim', communes: ['Porto Amboim', 'Capolo'] },
      { name: 'Quibala', communes: ['Quibala', 'Dala Cachibo'] },
      { name: 'Quilenda', communes: ['Quilenda'] },
      { name: 'Seles', communes: ['Seles', 'Botera'] },
      { name: 'Sumbe', communes: ['Sumbe', 'Quicombo'] },
      { name: 'Quirimbo', communes: ['Quirimbo'] },
      { name: 'Munenga', communes: ['Munenga'] },
      { name: 'Quissongo', communes: ['Quissongo'] },
      { name: 'Gungo', communes: ['Gungo'] },
      { name: 'Sanga', communes: ['Sanga'] },
      { name: 'Gangula', communes: ['Gangula'] },
      { name: 'Pambangala', communes: ['Pambangala'] },
      { name: 'Condé', communes: ['Condé'] },
      { name: 'Amboiva', communes: ['Amboiva'] },
      { name: 'Lonhe', communes: ['Lonhe', 'Cariango'] },
      { name: 'Quenha', communes: ['Quenha'] },
      { name: 'Boa Entrada', communes: ['Boa Entrada'] }
    ]
  },
  {
    name: 'Cubango',
    capital: 'Menongue',
    municipalities: [
      { name: 'Calai', communes: ['Calai'] },
      { name: 'Cuangar', communes: ['Cuangar'] },
      { name: 'Cuchi', communes: ['Cuchi'] },
      { name: 'Cutato', communes: ['Cutato', 'Vissati'] },
      { name: 'Caiundo', communes: ['Caiundo', 'Jamba Cueio'] },
      { name: 'Longa', communes: ['Longa', 'Baixo Longa'] },
      { name: 'Menongue', communes: ['Menongue'] },
      { name: 'Nancova', communes: ['Nancova', 'Rito'] },
      { name: 'Savate', communes: ['Savate', 'Bondo Caíla'] },
      { name: 'Chinguanja', communes: ['Chinguanja'] },
      { name: 'Mavengue', communes: ['Mavengue', 'Maué'] }
    ]
  },
  {
    name: 'Cunene',
    capital: 'Cuanhama',
    municipalities: [
      { name: 'Cahama', communes: ['Cahama', 'Otchinjau'] },
      { name: 'Cuanhama', communes: ['Ondjiva', 'Môngua'] },
      { name: 'Curoca', communes: ['Curoca'] },
      { name: 'Cuvelai', communes: ['Cuvelai'] },
      { name: 'Namacunde', communes: ['Namacunde'] },
      { name: 'Ombandja', communes: ['Xangongo', 'Ombala yo Mungu'] },
      { name: 'Chiéde', communes: ['Chiéde'] },
      { name: 'Nehone', communes: ['Nehone', 'Evale'] },
      { name: 'Humbe', communes: ['Mucope', 'Humbe'] },
      { name: 'Mupa', communes: ['Mupa'] },
      { name: 'Naulila', communes: ['Naulila'] },
      { name: 'Chitado', communes: ['Chitado'] },
      { name: 'Cafima', communes: ['Cafima'] },
      { name: 'Chissuata', communes: ['Chissuata'] }
    ]
  },
  {
    name: 'Huambo',
    capital: 'Huambo',
    municipalities: [
      { name: 'Bailundo', communes: ['Bailundo', 'Lunge', 'Luvemba'] },
      { name: 'Caála', communes: ['Caála'] },
      { name: 'Cachiungo', communes: ['Chinhama', 'Cachiungo'] },
      { name: 'Chicala Choloanga', communes: ['Mbave', 'Chicala'] },
      { name: 'Chinjenje', communes: ['Chinjenje', 'Chiaca'] },
      { name: 'Ecunha', communes: ['Ecunha', 'Quipeio'] },
      { name: 'Huambo', communes: ['Huambo', 'Calima'] },
      { name: 'Londuimbali', communes: ['Londuimbali', 'Ussoque'] },
      { name: 'Longonjo', communes: ['Longonjo', 'Lépi'] },
      { name: 'Mungo', communes: ['Mungo', 'Cambuengo'] },
      { name: 'Ucuma', communes: ['Ucuma', 'Cacoma', 'Mundundo'] },
      { name: 'Bimbe', communes: ['Bimbe', 'Hengue'] },
      { name: 'Sambo', communes: ['Sambo', 'Samboto'] },
      { name: 'Galanga', communes: ['Galanga', 'Cumbira'] },
      { name: 'Alto Hama', communes: ['Alto Hama'] },
      { name: 'Chilata', communes: ['Chilata'] },
      { name: 'Cuima', communes: ['Cuima', 'Catata'] }
    ]
  },
  {
    name: 'Huíla',
    capital: 'Lubango',
    municipalities: [
      { name: 'Caconda', communes: ['Caconda', 'Gungue', 'Uaba', 'Cusse'] },
      { name: 'Cacula', communes: ['Cacula', 'Tchicuaqueia'] },
      { name: 'Caluquembe', communes: ['Caluquembe', 'Calepi', 'Negola'] },
      { name: 'Chibia', communes: ['Chibia', 'Jau'] },
      { name: 'Chicomba', communes: ['Chicomba', 'Cutenda'] },
      { name: 'Chipindo', communes: ['Chipindo', 'Bambi'] },
      { name: 'Cuvango', communes: ['Cuvango'] },
      { name: 'Gambos', communes: ['Chiange', 'Chimbemba'] },
      { name: 'Humpata', communes: ['Humpata'] },
      { name: 'Jamba Mineira', communes: ['Cassinga', 'Jamba Mineira'] },
      { name: 'Lubango', communes: ['Lubango', 'Huíla'] },
      { name: 'Matala', communes: ['Matala'] },
      { name: 'Quilengues', communes: ['Quilengues', 'Impulo', 'Dinde'] },
      { name: 'Quipungo', communes: ['Quipungo'] },
      { name: 'Dongo', communes: ['Dongo'] },
      { name: 'Hoque', communes: ['Hoque'] },
      { name: 'Capelongo', communes: ['Capelongo', 'Mulondo'] },
      { name: 'Chituto', communes: ['Chituto'] },
      { name: 'Capunda Cavilongo', communes: ['Capunda Cavilongo', 'Quihita'] },
      { name: 'Viti Vivali', communes: ['Viti Vivali'] },
      { name: 'Galangue', communes: ['Galangue'] },
      { name: 'Palanca', communes: ['Palanca'] },
      { name: 'Chicungo', communes: ['Chicungo'] }
    ]
  },
  {
    name: 'Icolo e Bengo',
    capital: 'Catete',
    municipalities: [
      { name: 'Catete', communes: ['Catete', 'Cassoneca', 'Caculo Cahango', 'Caxicane'] },
      { name: 'Quiçama', communes: ['Muxima', 'Quixinge', 'Demba Chio', 'Mumbondo'] },
      { name: 'Calumbo', communes: ['Calumbo'] },
      { name: 'Cabiri', communes: ['Cabiri'] },
      { name: 'Cabo Ledo', communes: ['Cabo Ledo'] },
      { name: 'Bom Jesus', communes: ['Bom Jesus'] },
      { name: 'Sequele', communes: ['Funda', 'Quifangondo', 'Sequele'] }
    ]
  },
  {
    name: 'Luanda',
    capital: 'Ingombota',
    municipalities: [
      { name: 'Belas', communes: ['Benfica', 'Cabolombo', 'Barra do Cuanza', 'Ramiros'] },
      { name: 'Cacuaco', communes: ['Cacuaco', 'Kikolo'] },
      { name: 'Cazenga', communes: ['Cazenga', 'Kima Kieza'] },
      { name: 'Kilamba Kiaxi', communes: ['Golfe', 'Nova Vida'] },
      { name: 'Viana', communes: ['Viana'] },
      { name: 'Mussulo', communes: ['Mussulo'] },
      { name: 'Sambizanga', communes: ['Sambizanga'] },
      { name: 'Rangel', communes: ['Rangel'] },
      { name: 'Maianga', communes: ['Maianga'] },
      { name: 'Samba', communes: ['Samba'] },
      { name: 'Camama', communes: ['Camama'] },
      { name: 'Mulenvos', communes: ['Mulenvos'] },
      { name: 'Kilamba', communes: ['Kilamba', 'Vila Flôr'] },
      { name: 'Hoji ya Henda', communes: ['Hoji ya Henda'] },
      { name: 'Ingombota', communes: ['Ingombota'] },
      { name: 'Talatona', communes: ['Talatona'] }
    ]
  },
  {
    name: 'Lunda-Norte',
    capital: 'Dundo',
    municipalities: [
      { name: 'Cambulo', communes: ['Cachimo', 'Nzage'] },
      { name: 'Capenda Camulemba', communes: ['Capenda Camulemba', 'Xinge'] },
      { name: 'Caungula', communes: ['Caungula'] },
      { name: 'Chitato', communes: ['Chitato'] },
      { name: 'Cuango', communes: ['Cuango'] },
      { name: 'Cuílo', communes: ['Caluango', 'Cuílo'] },
      { name: 'Lubalo', communes: ['Muvuluege', 'Lubalo'] },
      { name: 'Lucapa', communes: ['Camissombo', 'Lucapa'] },
      { name: 'Lóvua', communes: ['Lóvua'] },
      { name: 'Xá-Muteba', communes: ['Xá-Muteba'] },
      { name: 'Dundo', communes: ['Dundo', 'Luachimo'] },
      { name: 'Xá Cassau', communes: ['Xá Cassau', 'Capaia'] },
      { name: 'Camaxilo', communes: ['Camaxilo'] },
      { name: 'Luangue', communes: ['Luangue'] },
      { name: 'Luremo', communes: ['Luremo'] },
      { name: 'Canzar', communes: ['Canzar', 'Luia'] },
      { name: 'Cassanje Calucala', communes: ['Cassanje Calucala', 'Iongo'] },
      { name: 'Mussungue', communes: ['Mussungue', 'Caíta'] },
      { name: 'Cafunfu', communes: ['Cafunfu'] }
    ]
  },
  {
    name: 'Lunda-Sul',
    capital: 'Saurimo',
    municipalities: [
      { name: 'Cacolo', communes: ['Cacolo'] },
      { name: 'Dala', communes: ['Dala'] },
      { name: 'Muconda', communes: ['Muconda'] },
      { name: 'Saurimo', communes: ['Mona Quimbundo', 'Saurimo'] },
      { name: 'Chiluage', communes: ['Chiluage'] },
      { name: 'Cassai-Sul', communes: ['Cassai-Sul'] },
      { name: 'Xassengue', communes: ['Xassengue', 'Cucumbi'] },
      { name: 'Alto Chicapa', communes: ['Alto Chicapa'] },
      { name: 'Sombo', communes: ['Sombo'] },
      { name: 'Muriege', communes: ['Muriege'] },
      { name: 'Luma Cassai', communes: ['Luma Cassai'] },
      { name: 'Cazage', communes: ['Cazage'] },
      { name: 'Muangueji', communes: ['Muangueji'] },
      { name: 'Cassengo', communes: ['Cassengo'] }
    ]
  },
  {
    name: 'Malanje',
    capital: 'Malanje',
    municipalities: [
      { name: 'Cacuso', communes: ['Cacuso', 'Soqueco'] },
      { name: 'Cahombo', communes: ['Micanda', 'Cahombo'] },
      { name: 'Calandula', communes: ['Calandula', 'Cota'] },
      { name: 'Cambundi Catembo', communes: ['Cambundi Catembo', 'Dumba Cambango'] },
      { name: 'Cangandala', communes: ['Cangandala', 'Caribo', 'Culamagia'] },
      { name: 'Kiwaba Nzoji', communes: ['Kiwaba Nzoji', 'Mufuma'] },
      { name: 'Kunda dya Baze', communes: ['Kunda dya Baze', 'Lemba'] },
      { name: 'Luquembo', communes: ['Luquembo', 'Dombo wa Zanga'] },
      { name: 'Malanje', communes: ['Malanje', 'Lombe'] },
      { name: 'Marimba', communes: ['Marimba', 'Mangando'] },
      { name: 'Massango', communes: ['Massango'] },
      { name: 'Quela', communes: ['Quela', 'Bângalas'] },
      { name: 'Quirima', communes: ['Quirima', 'Sautar'] },
      { name: 'Cateco Cangola', communes: ['Cateco Cangola'] },
      { name: 'Cuale', communes: ['Cuale'] },
      { name: 'Pungo a Ndongo', communes: ['Pungo a Ndongo'] },
      { name: 'Ngola Luiji', communes: ['Ngola Luiji', 'Cambaxe'] },
      { name: 'Quihuhu', communes: ['Quihuhu', 'Quinguengue'] },
      { name: 'Xandel', communes: ['Xandel', 'Moma'] },
      { name: 'Cambo Suiginge', communes: ['Cambo Suiginge'] },
      { name: 'Milando', communes: ['Milando'] },
      { name: 'Quitapa', communes: ['Quitapa'] },
      { name: 'Capunda', communes: ['Capunda', 'Quimbango', 'Cunga Palanga'] },
      { name: 'Muquixe', communes: ['Muquixe'] },
      { name: 'Quêssua', communes: ['Quêssua'] },
      { name: 'Caculama', communes: ['Caculama', 'Caxinga'] },
      { name: 'Mbanji ya Ngola', communes: ['Mbanji ya Ngola', 'Cabombo'] }
    ]
  },
  {
    name: 'Moxico',
    capital: 'Luena',
    municipalities: [
      { name: 'Chiúme', communes: ['Chiúme'] },
      { name: 'Lumbala Nguimbo', communes: ['Lumbala Nguimbo', 'Mussuma Mitete', 'Sessa'] },
      { name: 'Camanongue', communes: ['Camanongue'] },
      { name: 'Léua', communes: ['Léua', 'Liangongo'] },
      { name: 'Alto Cuito', communes: ['Alto Cuito'] },
      { name: 'Lutembo', communes: ['Lutembo', 'Luvuei'] },
      { name: 'Cangumbe', communes: ['Cangumbe'] },
      { name: 'Luena', communes: ['Luena', 'Cassongo'] },
      { name: 'Cangamba', communes: ['Cangombe', 'Cassamba', 'Cangamba', 'Muié'] },
      { name: 'Lucusse', communes: ['Lucusse'] },
      { name: 'Ninda', communes: ['Ninda'] },
      { name: 'Lutuai', communes: ['Lutuai'] }
    ]
  },
  {
    name: 'Moxico Leste',
    capital: 'Cazombo',
    municipalities: [
      { name: 'Cazombo', communes: ['Cazombo', 'Lumbala Caquengue'] },
      { name: 'Luacano', communes: ['Luacano'] },
      { name: 'Cameia', communes: ['Cameia'] },
      { name: 'Luau', communes: ['Luau'] },
      { name: 'Nana Candundo', communes: ['Nana Candundo'] },
      { name: 'Macondo', communes: ['Macondo', 'Calunda'] },
      { name: 'Caianda', communes: ['Caianda'] },
      { name: 'Lóvua do Zambeze', communes: ['Lóvua do Zambeze'] },
      { name: 'Lago Dilolo', communes: ['Lago Dilolo'] }
    ]
  },
  {
    name: 'Namibe',
    capital: 'Moçâmedes',
    municipalities: [
      { name: 'Moçâmedes', communes: ['Moçâmedes'] },
      { name: 'Camucuio', communes: ['Camucuio', 'Mamué', 'Chingo'] },
      { name: 'Bibala', communes: ['Bibala', 'Capangombe', 'Caitou', 'Lola'] },
      { name: 'Virei', communes: ['Virei', 'Cainde'] },
      { name: 'Tômbua', communes: ['Tômbua'] },
      { name: 'Lucira', communes: ['Lucira', 'Bentiaba'] },
      { name: 'Iona', communes: ['Iona'] },
      { name: 'Sacomar', communes: ['Sacomar'] },
      { name: 'Cacimbas', communes: ['Cacimbas'] }
    ]
  },
  {
    name: 'Uíge',
    capital: 'Uíge',
    municipalities: [
      { name: 'Uíge', communes: ['Uíge', 'Luanga', 'Casseche', 'Cancungo'] },
      { name: 'Cangola', communes: ['Cangola', 'Bengo', 'Caiongo'] },
      { name: 'Ambuíla', communes: ['Ambuíla'] },
      { name: 'Bembe', communes: ['Bembe', 'Mabaia'] },
      { name: 'Nova Esperança', communes: ['Nova Esperança', 'Buenga-Sul', 'Cuilo Camboso'] },
      { name: 'Bungo', communes: ['Bungo'] },
      { name: 'Milunga', communes: ['Milunga', 'Macocola'] },
      { name: 'Damba', communes: ['Damba', 'Petecusso', 'Camatambo', 'Lêmboa'] },
      { name: 'Maquela do Zombo', communes: ['Maquela do Zombo', 'Quibocolo'] },
      { name: 'Mucaba', communes: ['Mucaba', 'Uando Mucaba'] },
      { name: 'Negage', communes: ['Negage', 'Dimuca', 'Quisseque'] },
      { name: 'Puri', communes: ['Puri'] },
      { name: 'Quimbele', communes: ['Quimbele', 'Icoca'] },
      { name: 'Dange Quitexe', communes: ['Quitexe', 'Aldeia Viçosa'] },
      { name: 'Sanza Pombo', communes: ['Sanza Pombo', 'Cuilo Pombo', 'Uamba', 'Alfândega'] },
      { name: 'Songo', communes: ['Songo', 'Quivuenga'] },
      { name: 'Sacandica', communes: ['Sacandica', 'Cuilo Futa', 'Béu'] },
      { name: 'Nsosso', communes: ['Nsosso'] },
      { name: 'Lucunga', communes: ['Lucunga'] },
      { name: 'Quipedro', communes: ['Quipedro'] },
      { name: 'Massau', communes: ['Massau', 'Macolo'] },
      { name: 'Vista Alegre', communes: ['Vista Alegre', 'Cambamba'] },
      { name: 'Alto Zaza', communes: ['Alto Zaza', 'Cuango Calumbo'] }
    ]
  },
  {
    name: 'Zaire',
    capital: 'Mbanza Kongo',
    municipalities: [
      { name: 'Mbanza Kongo', communes: ['Mbanza Kongo', 'Caluca', 'Madimba', 'Quiende'] },
      { name: 'Soyo', communes: ['Soyo', 'Pedra de Feitiço'] },
      { name: 'Nzeto', communes: ['Nzeto', 'Musserra', 'Quibala Norte'] },
      { name: 'Cuimba', communes: ['Cuimba', 'Buela', 'Luvaca'] },
      { name: 'Nóqui', communes: ['Nóqui', 'Mpala'] },
      { name: 'Tomboco', communes: ['Tomboco', 'Quinsimba', 'Quinzau'] },
      { name: 'Luvo', communes: ['Luvo'] },
      { name: 'Lufico', communes: ['Lufico'] },
      { name: 'Quêlo', communes: ['Quêlo'] },
      { name: 'Serra de Canda', communes: ['Serra de Canda'] },
      { name: 'Quindeje', communes: ['Quibala-Norte', 'Quindeje'] }
    ]
  }
];

/** Nomes das 21 províncias, em ordem alfabética — atalho para preencher o 1.º selector. */
export const ANGOLA_PROVINCE_NAMES: string[] = ANGOLA_DIVISIONS.map((p) => p.name);

/** Devolve os municípios de uma província (pelo nome), ou [] se não encontrada. */
export function getMunicipalitiesForProvince(provinceName: string): AngolaMunicipality[] {
  const province = ANGOLA_DIVISIONS.find((p) => p.name === provinceName);
  return province ? province.municipalities : [];
}

/** Devolve as comunas de um município de uma província, ou [] se não encontrado. */
export function getCommunesForMunicipality(provinceName: string, municipalityName: string): string[] {
  const municipality = getMunicipalitiesForProvince(provinceName).find((m) => m.name === municipalityName);
  return municipality ? municipality.communes : [];
}
