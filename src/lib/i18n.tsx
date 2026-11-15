import React, { createContext, useContext, useEffect, useState } from 'react';
import { Globe } from 'lucide-react';

export type AppLanguage = 'en' | 'es' | 'fr' | 'pt' | 'ar' | 'hi' | 'sw' | 'zh';

export interface LanguageOption {
  code: AppLanguage;
  nativeName: string;
  regionHint: string;
  rtl?: boolean;
}

export const GLOBAL_LANGUAGES: LanguageOption[] = [
  { code: 'en', nativeName: 'English', regionHint: 'Global' },
  { code: 'es', nativeName: 'Español', regionHint: 'Americas / Europe' },
  { code: 'fr', nativeName: 'Français', regionHint: 'Africa / Europe' },
  { code: 'pt', nativeName: 'Português', regionHint: 'Brazil / Lusophone' },
  { code: 'ar', nativeName: 'العربية', regionHint: 'MENA / Sahel', rtl: true },
  { code: 'hi', nativeName: 'हिन्दी', regionHint: 'South Asia' },
  { code: 'sw', nativeName: 'Kiswahili', regionHint: 'East Africa' },
  { code: 'zh', nativeName: '中文', regionHint: 'East Asia' },
];

type TranslationDict = Record<string, string>;

const TRANSLATIONS: Record<AppLanguage, TranslationDict> = {
  en: {
    'nav.earth': 'Earth Observations',
    'nav.rotations': 'Rotation Engine',
    'nav.rigor': 'Scientific Rigor',
    'nav.access': 'Platform Access',
    'nav.registerFarm': 'Register Farm',
    'hero.tag': 'Global Agricultural Decision Support · Live Weather & NASA Satellites',
    'hero.title': 'Satellite intelligence for resilient crop rotations.',
    'hero.subtitle':
      'FarmNova AI translates live weather forecasts, NASA rainfall, temperature, root-zone soil wetness, and terrain elevation into practical crop-rotation options for farmers worldwide.',
    'auth.signInTitle': 'Sign in to your farm',
    'auth.registerTitle': 'Create a farmer account',
    'auth.guestBtn': 'Continue Without Registering (Explore Farmer Workspace)',
    'auth.googleBtn': 'Continue with Google',
    'auth.exit': 'Exit',
    'sidebar.overview': 'Overview',
    'sidebar.nasa': 'Weather, Hazards & NASA',
    'sidebar.map': 'Geospatial Map',
    'sidebar.rotations': 'Rotation & Crops',
    'sidebar.scenarios': 'Climate Scenarios',
    'sidebar.assistant': 'AI Assistant',
    'sidebar.reports': 'Reports & Export',
    'sidebar.account': 'Account Settings',
    'sidebar.admin': 'Admin Console',
    'sidebar.signOut': 'Sign Out',
    'sidebar.addFarm': 'Add Farm',
    'sidebar.newFarm': 'New Farm',
    'sidebar.editFarm': 'Edit Farm',
    'env.title': 'Plain-Language Weather, Hazards & NASA Farm Report',
    'env.subtitle': 'Live 7-day weather forecast, hazard warnings, and NASA satellite observations explained simply for your field at',
    'env.simpleMode': 'Simple Farmer View',
    'env.techMode': 'Technical Scientist View',
    'env.refresh': 'Refresh Live Data',
    'env.refreshing': 'Refreshing...',
    'env.weatherTitle': 'Live Weather Right Now & 7-Day Farm Forecast',
    'env.hazardsTitle': 'Potential Farm Hazards & Recommended Field Actions',
    'env.plainSummaryTitle': 'What NASA Satellites Show About Your Land (In Simple Terms)',
    'env.rainCard': 'Rain & Water Supply',
    'env.heatCard': 'Warmth & Heat Risk',
    'env.soilCard': 'Underground Soil Moisture',
    'env.slopeCard': 'Land Slope & Washout Risk',
    'env.next7Days': 'Next 7 Days',
    'env.humidity': 'Humidity',
    'env.wind': 'Wind',
    'env.feelsLike': 'Feels like',
    'env.rainChance': 'Rain chance',
  },
  es: {
    'nav.earth': 'Observaciones',
    'nav.rotations': 'Rotaciones',
    'nav.rigor': 'Rigor Científico',
    'nav.access': 'Acceso',
    'nav.registerFarm': 'Registrar Finca',
    'hero.tag': 'Soporte Agrícola Global · Clima en Vivo y Satélites NASA',
    'hero.title': 'Inteligencia satelital para rotaciones de cultivos resilientes.',
    'hero.subtitle':
      'FarmNova AI convierte pronósticos del tiempo en vivo, lluvia NASA, temperatura, humedad del suelo y relieve en opciones prácticas de rotación de cultivos para agricultores de todo el mundo.',
    'auth.signInTitle': 'Inicia sesión en tu finca',
    'auth.registerTitle': 'Crear cuenta de agricultor',
    'auth.guestBtn': 'Continuar sin registrarse (Explorar Panel Agrícola)',
    'auth.googleBtn': 'Continuar con Google',
    'auth.exit': 'Salir',
    'sidebar.overview': 'Resumen',
    'sidebar.nasa': 'Clima, Riesgos y NASA',
    'sidebar.map': 'Mapa Satelital',
    'sidebar.rotations': 'Rotación y Cultivos',
    'sidebar.scenarios': 'Escenarios Climáticos',
    'sidebar.assistant': 'Asistente IA',
    'sidebar.reports': 'Informes y Exportación',
    'sidebar.account': 'Configuración',
    'sidebar.admin': 'Administración',
    'sidebar.signOut': 'Cerrar Sesión',
    'sidebar.addFarm': 'Añadir Finca',
    'sidebar.newFarm': 'Nueva Finca',
    'sidebar.editFarm': 'Editar Finca',
    'env.title': 'Clima en Vivo, Riesgos y Reporte NASA en Lenguaje Sencillo',
    'env.subtitle': 'Pronóstico en tiempo real de 7 días, alertas de riesgos y observaciones NASA explicadas claramente para',
    'env.simpleMode': 'Vista Simple (Agricultor)',
    'env.techMode': 'Vista Técnica',
    'env.refresh': 'Actualizar Datos',
    'env.refreshing': 'Actualizando...',
    'env.weatherTitle': 'Clima Actual en Vivo y Pronóstico a 7 Días',
    'env.hazardsTitle': 'Posibles Riesgos Agrícolas y Acciones en Campo',
    'env.plainSummaryTitle': 'Lo que muestran los satélites de la NASA sobre su tierra',
    'env.rainCard': 'Lluvia y Agua Disponible',
    'env.heatCard': 'Calor y Estrés Térmico',
    'env.soilCard': 'Humedad Subterránea del Suelo',
    'env.slopeCard': 'Pendiente y Riesgo de Erosión',
    'env.next7Days': 'Próximos 7 Días',
    'env.humidity': 'Humedad',
    'env.wind': 'Viento',
    'env.feelsLike': 'Sensación',
    'env.rainChance': 'Prob. lluvia',
  },
  fr: {
    'nav.earth': 'Observations',
    'nav.rotations': 'Rotations',
    'nav.rigor': 'Rigueur Scientifique',
    'nav.access': 'Accès',
    'nav.registerFarm': 'Inscrire une Ferme',
    'hero.tag': 'Aide à la Décision Agricole Mondiale · Météo en Direct & Satellites NASA',
    'hero.title': 'L’intelligence satellitaire pour des rotations de cultures résilientes.',
    'hero.subtitle':
      'FarmNova AI traduit les prévisions météo en direct, les pluies NASA, la température, l’humidité racinaire du sol et le relief en rotations culturales pratiques partout dans le monde.',
    'auth.signInTitle': 'Accéder à votre ferme',
    'auth.registerTitle': 'Créer un compte agriculteur',
    'auth.guestBtn': 'Continuer sans s’inscrire (Explorer l’Espace Ferme)',
    'auth.googleBtn': 'Continuer avec Google',
    'auth.exit': 'Quitter',
    'sidebar.overview': 'Vue d’ensemble',
    'sidebar.nasa': 'Météo, Risques & NASA',
    'sidebar.map': 'Carte Satellitaire',
    'sidebar.rotations': 'Rotations & Cultures',
    'sidebar.scenarios': 'Scénarios Climatiques',
    'sidebar.assistant': 'Assistant IA',
    'sidebar.reports': 'Rapports & Export',
    'sidebar.account': 'Paramètres',
    'sidebar.admin': 'Administration',
    'sidebar.signOut': 'Déconnexion',
    'sidebar.addFarm': 'Ajouter',
    'sidebar.newFarm': 'Nouvelle Ferme',
    'sidebar.editFarm': 'Modifier',
    'env.title': 'Météo en Direct, Risques & Rapport NASA Simplifié',
    'env.subtitle': 'Prévisions météo sur 7 jours, alertes agricoles et observations satellites NASA expliquées simplement pour',
    'env.simpleMode': 'Vue Simple Agriculteur',
    'env.techMode': 'Vue Technique',
    'env.refresh': 'Actualiser',
    'env.refreshing': 'Mise à jour...',
    'env.weatherTitle': 'Météo Actuelle en Direct & Prévisions sur 7 Jours',
    'env.hazardsTitle': 'Risques Potentiels & Actions Pratiques au Champ',
    'env.plainSummaryTitle': 'Ce que montrent les satellites NASA sur votre parcelle',
    'env.rainCard': 'Pluie et Apport en Eau',
    'env.heatCard': 'Chaleur et Stress Thermique',
    'env.soilCard': 'Humidité Souterraine du Sol',
    'env.slopeCard': 'Pente & Risque de Ruissellement',
    'env.next7Days': '7 Prochains Jours',
    'env.humidity': 'Humidité',
    'env.wind': 'Vent',
    'env.feelsLike': 'Ressenti',
    'env.rainChance': 'Risque pluie',
  },
  pt: {
    'nav.earth': 'Observações',
    'nav.rotations': 'Rotações',
    'nav.rigor': 'Rigor Científico',
    'nav.access': 'Acesso',
    'nav.registerFarm': 'Cadastrar Fazenda',
    'hero.tag': 'Suporte Agrícola Global · Previsão em Tempo Real & Satélites NASA',
    'hero.title': 'Inteligência de satélite para rotações de culturas resilientes.',
    'hero.subtitle':
      'FarmNova AI transforma previsões meteorológicas ao vivo, chuvas da NASA, temperatura, umidade do solo e relevo em opções práticas de rotação para produtores no mundo todo.',
    'auth.signInTitle': 'Entrar na sua fazenda',
    'auth.registerTitle': 'Criar conta de produtor',
    'auth.guestBtn': 'Continuar sem cadastro (Explorar Painel)',
    'auth.googleBtn': 'Continuar com Google',
    'auth.exit': 'Sair',
    'sidebar.overview': 'Visão Geral',
    'sidebar.nasa': 'Clima, Riscos & NASA',
    'sidebar.map': 'Mapa Geoespacial',
    'sidebar.rotations': 'Rotação & Culturas',
    'sidebar.scenarios': 'Cenários Climáticos',
    'sidebar.assistant': 'Assistente IA',
    'sidebar.reports': 'Relatórios',
    'sidebar.account': 'Configurações',
    'sidebar.admin': 'Administração',
    'sidebar.signOut': 'Sair',
    'sidebar.addFarm': 'Nova Fazenda',
    'sidebar.newFarm': 'Nova Fazenda',
    'sidebar.editFarm': 'Editar',
    'env.title': 'Clima em Tempo Real, Riscos e Resumo NASA Simples',
    'env.subtitle': 'Previsão de 7 dias, alertas de risco e dados da NASA explicados em linguagem clara para',
    'env.simpleMode': 'Modo Simples (Produtor)',
    'env.techMode': 'Modo Técnico',
    'env.refresh': 'Atualizar Dados',
    'env.refreshing': 'Atualizando...',
    'env.weatherTitle': 'Clima Agora e Previsão de 7 Dias',
    'env.hazardsTitle': 'Riscos Agrícolas Potenciais e Ações no Campo',
    'env.plainSummaryTitle': 'O que os satélites da NASA mostram sobre sua terra',
    'env.rainCard': 'Chuva e Água',
    'env.heatCard': 'Calor e Risco Térmico',
    'env.soilCard': 'Umidade Profunda do Solo',
    'env.slopeCard': 'Declive e Erosão',
    'env.next7Days': 'Próximos 7 Dias',
    'env.humidity': 'Umidade',
    'env.wind': 'Vento',
    'env.feelsLike': 'Sensação',
    'env.rainChance': 'Chance chuva',
  },
  ar: {
    'nav.earth': 'رصد الأرض',
    'nav.rotations': 'دورة المحاصيل',
    'nav.rigor': 'الدقة العلمية',
    'nav.access': 'الدخول',
    'nav.registerFarm': 'تسجيل مزرعة',
    'hero.tag': 'دعم زراعي عالمي · طقس مباشر وأقمار ناسا الصناعية',
    'hero.title': 'ذكاء الأقمار الصناعية لدورات زراعية أكثر مرونة.',
    'hero.subtitle':
      'يحول FarmNova AI توقعات الطقس المباشرة وبيانات أمطار ناسا والحرارة ورطوبة التربة والارتفاع إلى خطط عملية لتناوب المحاصيل للمزارعين حول العالم.',
    'auth.signInTitle': 'تسجيل الدخول إلى مزرعتك',
    'auth.registerTitle': 'إنشاء حساب مزارع',
    'auth.guestBtn': 'المتابعة دون تسجيل (استكشاف مساحة المزارع)',
    'auth.googleBtn': 'المتابعة باستخدام Google',
    'auth.exit': 'خروج',
    'sidebar.overview': 'نظرة عامة',
    'sidebar.nasa': 'الطقس والمخاطر وناسا',
    'sidebar.map': 'الخريطة الفضائية',
    'sidebar.rotations': 'الدورة والمحاصيل',
    'sidebar.scenarios': 'سيناريوهات المناخ',
    'sidebar.assistant': 'المساعد الذكي',
    'sidebar.reports': 'التقارير',
    'sidebar.account': 'الإعدادات',
    'sidebar.admin': 'الإدارة',
    'sidebar.signOut': 'تسجيل الخروج',
    'sidebar.addFarm': 'إضافة مزرعة',
    'sidebar.newFarm': 'مزرعة جديدة',
    'sidebar.editFarm': 'تعديل المزرعة',
    'env.title': 'الطقس المباشر والمخاطر وتقرير ناسا بلغة مبسطة',
    'env.subtitle': 'توقعات الطقس المباشرة لـ 7 أيام وتحذيرات المخاطر وملاحظات ناسا مشروحة ببساطة لموقع',
    'env.simpleMode': 'عرض مبسط للمزارع',
    'env.techMode': 'عرض علمي مفصل',
    'env.refresh': 'تحديث مباشر',
    'env.refreshing': 'جاري التحديث...',
    'env.weatherTitle': 'الطقس الحالي وتوقعات 7 أيام مباشرة',
    'env.hazardsTitle': 'المخاطر الزراعية المحتملة وإجراءات الحقل',
    'env.plainSummaryTitle': 'ماذا تظهر أقمار ناسا عن أرضك (ببساطة)',
    'env.rainCard': 'الأمطار والمياه',
    'env.heatCard': 'الحرارة وإجهاد الحر',
    'env.soilCard': 'رطوبة التربة العميقة',
    'env.slopeCard': 'انحدار الأرض والانجراف',
    'env.next7Days': 'الـ 7 أيام القادمة',
    'env.humidity': 'الرطوبة',
    'env.wind': 'الرياح',
    'env.feelsLike': 'المحسوسة',
    'env.rainChance': 'فرصة المطر',
  },
  hi: {
    'nav.earth': 'पृथ्वी अवलोकन',
    'nav.rotations': 'फसल चक्र',
    'nav.rigor': 'वैज्ञानिक आधार',
    'nav.access': 'प्रवेश',
    'nav.registerFarm': 'खेत जोड़ें',
    'hero.tag': 'वैश्विक कृषि निर्णय सहायता · लाइव मौसम और नासा उपग्रह',
    'hero.title': 'लचीले फसल चक्र के लिए सैटेलाइट बुद्धिमत्ता।',
    'hero.subtitle':
      'FarmNova AI दुनिया भर के किसानों के लिए लाइव मौसम पूर्वानुमान, नासा वर्षा, तापमान, मिट्टी की नमी और ढलान को आसान फसल-चक्र सलाह में बदलता है।',
    'auth.signInTitle': 'अपने खेत में लॉगिन करें',
    'auth.registerTitle': 'किसान खाता बनाएं',
    'auth.guestBtn': 'बिना पंजीकरण जारी रखें (किसान कार्यक्षेत्र देखें)',
    'auth.googleBtn': 'Google के साथ जारी रखें',
    'auth.exit': 'बाहर निकलें',
    'sidebar.overview': 'सारांश',
    'sidebar.nasa': 'मौसम, जोखिम और नासा',
    'sidebar.map': 'सैटेलाइट मानचित्र',
    'sidebar.rotations': 'फसल चक्र और फसलें',
    'sidebar.scenarios': 'जलवायु परिदृश्य',
    'sidebar.assistant': 'AI सहायक',
    'sidebar.reports': 'रिपोर्ट और निर्यात',
    'sidebar.account': 'खाता सेटिंग्स',
    'sidebar.admin': 'एडमिन पैनल',
    'sidebar.signOut': 'लॉगआउट',
    'sidebar.addFarm': 'खेत जोड़ें',
    'sidebar.newFarm': 'नया खेत',
    'sidebar.editFarm': 'खेत बदलें',
    'env.title': 'सरल भाषा में लाइव मौसम, खतरे और नासा रिपोर्ट',
    'env.subtitle': 'अगले 7 दिनों का लाइव मौसम, संभावित खतरे और नासा उपग्रह डेटा सरल शब्दों में',
    'env.simpleMode': 'सरल किसान दृश्य',
    'env.techMode': 'तकनीकी दृश्य',
    'env.refresh': 'डेटा रीफ़्रेश करें',
    'env.refreshing': 'लोड हो रहा है...',
    'env.weatherTitle': 'अभी का लाइव मौसम और 7-दिन का पूर्वानुमान',
    'env.hazardsTitle': 'संभावित कृषि खतरे और बचाव के उपाय',
    'env.plainSummaryTitle': 'आपकी ज़मीन के बारे में नासा उपग्रह क्या दिखाते हैं',
    'env.rainCard': 'बारिश और पानी',
    'env.heatCard': 'गर्मी और लू का खतरा',
    'env.soilCard': 'ज़मीन के अंदर की नमी',
    'env.slopeCard': 'ढलान और मिट्टी कटाव',
    'env.next7Days': 'अगले 7 दिन',
    'env.humidity': 'नमी',
    'env.wind': 'हवा',
    'env.feelsLike': 'महसूस तापमान',
    'env.rainChance': 'बारिश की संभावना',
  },
  sw: {
    'nav.earth': 'Uchunguzi wa Anga',
    'nav.rotations': 'Mzunguko wa Mazao',
    'nav.rigor': 'Uwazi wa Kisayansi',
    'nav.access': 'Ingia',
    'nav.registerFarm': 'Sajili Shamba',
    'hero.tag': 'Msaada wa Kilimo Duniani · Hali ya Hewa Mubashara & Satelaiti za NASA',
    'hero.title': 'Ujasusi wa satelaiti kwa mzunguko imara wa mazao.',
    'hero.subtitle':
      'FarmNova AI hubadilisha utabiri wa hali ya hewa mubashara, mvua ya NASA, joto, unyevu wa udongo na mteremko kuwa mwongozo rahisi kwa wakulima kote duniani.',
    'auth.signInTitle': 'Ingia kwenye shamba lako',
    'auth.registerTitle': 'Fungua akaunti ya mkulima',
    'auth.guestBtn': 'Endelea Bila Kujisajili (Jaribu Eneo la Mkulima)',
    'auth.googleBtn': 'Endelea na Google',
    'auth.exit': 'Ondoka',
    'sidebar.overview': 'Muhtasari',
    'sidebar.nasa': 'Hali ya Hewa, Hatari & NASA',
    'sidebar.map': 'Ramani ya Satelaiti',
    'sidebar.rotations': 'Mzunguko & Mazao',
    'sidebar.scenarios': 'Hali za Tabianchi',
    'sidebar.assistant': 'Msaidizi wa AI',
    'sidebar.reports': 'Ripoti',
    'sidebar.account': 'Mipangilio',
    'sidebar.admin': 'Usimamizi',
    'sidebar.signOut': 'Toka',
    'sidebar.addFarm': 'Ongeza Shamba',
    'sidebar.newFarm': 'Shamba Jipya',
    'sidebar.editFarm': 'Hariri Shamba',
    'env.title': 'Hali ya Hewa Mubashara, Hatari & Ripoti Rahisi ya NASA',
    'env.subtitle': 'Utabiri wa siku 7 mubashara, tahadhari za hatari na taarifa za NASA kwa lugha rahisi kwa',
    'env.simpleMode': 'Mwonekano Rahisi wa Mkulima',
    'env.techMode': 'Mwonekano wa Kitaalamu',
    'env.refresh': 'Onyesha Upya',
    'env.refreshing': 'Inapakia...',
    'env.weatherTitle': 'Hali ya Hewa Sasa & Utabiri wa Siku 7',
    'env.hazardsTitle': 'Hatari Zinazoweza Kutokea & Hatua za Kuchukua',
    'env.plainSummaryTitle': 'Satelaiti za NASA Zinaonyesha Nini Kuhusu Shamba Lako',
    'env.rainCard': 'Mvua & Maji',
    'env.heatCard': 'Joto & Hatari ya Jua Kali',
    'env.soilCard': 'Unyevu wa Udongo Chini',
    'env.slopeCard': 'Mteremko & Mmomonyoko',
    'env.next7Days': 'Siku 7 Zijazo',
    'env.humidity': 'Unyevu hewani',
    'env.wind': 'Upepo',
    'env.feelsLike': 'Huhisiwa kama',
    'env.rainChance': 'Uwezekano wa mvua',
  },
  zh: {
    'nav.earth': '地球观测',
    'nav.rotations': '轮作引擎',
    'nav.rigor': '科学依据',
    'nav.access': '平台登录',
    'nav.registerFarm': '登记农场',
    'hero.tag': '全球农业决策支持 · 实时天气预报与 NASA 卫星观测',
    'hero.title': '面向强韧轮作农业的卫星智能决策平台。',
    'hero.subtitle':
      'FarmNova AI 将全球各地农场的实时天气预报、NASA 降水、气温、根区土壤湿度及地形坡度转化为通俗实用的轮作方案。',
    'auth.signInTitle': '登录您的农场',
    'auth.registerTitle': '创建农户账号',
    'auth.guestBtn': '暂不注册，直接体验农户工作台',
    'auth.googleBtn': '使用 Google 账号继续',
    'auth.exit': '退出',
    'sidebar.overview': '总览',
    'sidebar.nasa': '天气、灾害与 NASA',
    'sidebar.map': '卫星地图',
    'sidebar.rotations': '轮作与作物',
    'sidebar.scenarios': '气候情景',
    'sidebar.assistant': 'AI 农艺助手',
    'sidebar.reports': '报告与导出',
    'sidebar.account': '账户设置',
    'sidebar.admin': '系统管理',
    'sidebar.signOut': '退出登录',
    'sidebar.addFarm': '添加农场',
    'sidebar.newFarm': '新建农场',
    'sidebar.editFarm': '编辑农场',
    'env.title': '通俗版实时天气、灾害预警与 NASA 观测报告',
    'env.subtitle': '为您清晰解读未来7天实时天气预报、潜在农业灾害及 NASA 卫星观测数据：',
    'env.simpleMode': '农户简明视图',
    'env.techMode': '科研专业视图',
    'env.refresh': '刷新实时数据',
    'env.refreshing': '正在更新...',
    'env.weatherTitle': '当前实时天气与未来7天预报',
    'env.hazardsTitle': '潜在农业灾害预警与田间应对措施',
    'env.plainSummaryTitle': 'NASA 卫星数据显示的农田现状（通俗解读）',
    'env.rainCard': '降水与水分供给',
    'env.heatCard': '温度与高温风险',
    'env.soilCard': '深层土壤墒情',
    'env.slopeCard': '地形坡度与水土流失',
    'env.next7Days': '未来7天',
    'env.humidity': '湿度',
    'env.wind': '风速',
    'env.feelsLike': '体感',
    'env.rainChance': '降水概率',
  },
};

interface I18nContextValue {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  t: (key: string, fallback?: string) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  setLanguage: () => {},
  t: (key, fallback) => TRANSLATIONS.en[key] ?? fallback ?? key,
  isRtl: false,
});

const STORAGE_KEY = 'farmnova_language';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) as AppLanguage | null) : null;
    if (saved && saved in TRANSLATIONS) return saved;
    if (typeof navigator !== 'undefined') {
      const browserLang = navigator.language.slice(0, 2) as AppLanguage;
      if (browserLang in TRANSLATIONS) return browserLang;
    }
    return 'en';
  });

  function setLanguage(lang: AppLanguage) {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore storage errors
    }
  }

  const activeMeta = GLOBAL_LANGUAGES.find((l) => l.code === language);
  const isRtl = Boolean(activeMeta?.rtl);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [language, isRtl]);

  function t(key: string, fallback?: string): string {
    return TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.en[key] ?? fallback ?? key;
  }

  return <I18nContext.Provider value={{ language, setLanguage, t, isRtl }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LanguageSelector({ dark = false }: { dark?: boolean }) {
  const { language, setLanguage } = useI18n();
  return (
    <div className="inline-flex items-center gap-1.5 shrink-0">
      <Globe className={`w-3.5 h-3.5 ${dark ? 'text-[#C8D4CD]' : 'text-[#5E6D64]'}`} />
      <select
        aria-label="Select platform language"
        value={language}
        onChange={(e) => setLanguage(e.target.value as AppLanguage)}
        className={`max-w-[105px] sm:max-w-none text-xs font-medium rounded-lg px-2 py-1.5 focus:outline-none ${
          dark
            ? 'bg-[#1C3B2D] border border-white/15 text-[#FAF8F3] focus:border-[#E4C37A]'
            : 'bg-white border border-[#D8D2C3] text-[#132A20] focus:border-[#0E4D3A]'
        }`}
      >
        {GLOBAL_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
