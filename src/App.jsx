import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════
//  🌐 SUPABASE CLIENT
// ════════════════════════════════════════════════════════════════
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
console.log("SUPA_URL:", SUPA_URL);
console.log("SUPA_KEY:", SUPA_KEY ? "presente" : "AUSENTE");
let supabase = null;
try {
  if (SUPA_URL && SUPA_KEY) supabase = createClient(SUPA_URL, SUPA_KEY);
  console.log("supabase:", supabase ? "inicializado" : "NULL");
} catch(e) { console.warn("Supabase init error:", e); }


// ════════════════════════════════════════════════════════════════
//  💰 DINHEIRO — Armazenado em centavos (inteiros) para precisão
//  Todas as operações internas usam centavos.
//  Apenas na exibição convertemos para reais.
// ════════════════════════════════════════════════════════════════
const toCents   = (reais) => Math.round(Number(reais) * 100);          // R$ → centavos
const toReais   = (cents) => Math.round(Number(cents) || 0) / 100;     // centavos → R$
const fmt       = (cents) => {                                           // centavos → "R$ 1.234,56" (sempre positivo — para valores individuais)
  const v = Math.abs(Math.round(Number(cents) || 0));
  const s = (v / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "R$ " + s;
};
const fmtSaldo  = (cents) => {                                           // centavos → "-R$ 1.234,56" (preserva sinal — para saldo)
  const n = Math.round(Number(cents) || 0);
  const v = Math.abs(n);
  const s = (v / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "-" : "") + "R$ " + s;
};
const fmtC = (cents) => {                                                // centavos → "R$1,2k"
  const v = Math.abs(Math.round(Number(cents) || 0)) / 100;
  return v >= 1000 ? "R$" + (v / 1000).toFixed(1) + "k" : "R$" + v.toFixed(2).replace(".",",");
};
const fmtInput = (cents) => (Math.round(Number(cents)||0)/100).toFixed(2); // para inputs

// Soma segura em centavos — evita ponto flutuante
const somarCents = (arr) => arr.reduce((s, v) => s + Math.round(Number(v) || 0), 0);

// ════════════════════════════════════════════════════════════════
//  🔒 SEGURANÇA
// ════════════════════════════════════════════════════════════════
const encode  = (s) => new TextEncoder().encode(s);
const buf2hex = (b) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,"0")).join("");
const hex2buf = (h) => new Uint8Array((h.match(/.{2}/g)||[]).map(x => parseInt(x,16)));
const san     = (s) => String(s||"").replace(/[<>"'`]/g,"").trim().slice(0,500);
const validarEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||""));

async function hashSenha(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km   = await crypto.subtle.importKey("raw", encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt, iterations:100000, hash:"SHA-256" }, km, 256);
  return buf2hex(salt)+":"+buf2hex(bits);
}
async function verificarSenha(senha, hash) {
  try {
    if (!hash?.includes(":")) return false;
    const [sH,hH] = hash.split(":");
    const km   = await crypto.subtle.importKey("raw", encode(senha), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt:hex2buf(sH), iterations:100000, hash:"SHA-256" }, km, 256);
    return buf2hex(bits)===hH;
  } catch { return false; }
}
function criarJWT(p) {
  const h=btoa(JSON.stringify({alg:"HS256",typ:"JWT"}));
  const b=btoa(JSON.stringify({...p,iat:Date.now(),exp:Date.now()+7*24*60*60*1000}));
  return h+"."+b+"."+btoa(h+"."+b+".atlas_v3");
}
function lerJWT(t) {
  try {
    if (!t||typeof t!=="string") return null;
    const p=t.split(".");
    if (p.length<2) return null;
    const pay=JSON.parse(atob(p[1]));
    return pay?.exp>Date.now() ? pay : null;
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════
//  💾 BANCO DE DADOS
// ════════════════════════════════════════════════════════════════
const DB = {
  get:(k)   =>{ try{return JSON.parse(localStorage.getItem("atv3_"+k)||"null");}catch{return null;} },
  set:(k,v) =>{ try{localStorage.setItem("atv3_"+k,JSON.stringify(v));}catch{} },
  del:(k)   =>{ try{localStorage.removeItem("atv3_"+k);}catch{} },
  uid:()    =>{ const s=()=>Math.random().toString(16).slice(2); return `${s().slice(0,8)}-${s().slice(0,4)}-4${s().slice(0,3)}-${(Math.floor(Math.random()*4)+8).toString(16)}${s().slice(0,3)}-${s().slice(0,12)}`; },
  usuarios:   ()=>DB.get("usuarios")  ||[],
  transacoes: ()=>DB.get("transacoes")||[],
  metas:      ()=>DB.get("metas")     ||[],
  perfis:     ()=>DB.get("perfis")    ||[],
  contas:          ()=>DB.get("contas")      ||[],
  salvarUsuarios:   (u)=>DB.set("usuarios",u),
  salvarTransacoes: (t)=>DB.set("transacoes",t),
  salvarMetas:      (m)=>DB.set("metas",m),
  salvarPerfis:     (p)=>DB.set("perfis",p),
  salvarContas:     (c)=>DB.set("contas",c),
  txDoUsuario:     (uid)=>DB.transacoes().filter(t=>t.userId===uid),
  metasDoUsuario:  (uid)=>DB.metas().filter(m=>m.userId===uid),
  perfilDoUsuario: (uid)=>DB.perfis().find(p=>p.userId===uid)||null,
  contasDoUsuario: (uid)=>DB.contas().filter(c=>c.userId===uid),
};

// ════════════════════════════════════════════════════════════════
//  🏷️ CATEGORIAS
// ════════════════════════════════════════════════════════════════
const CATEGORIAS=["Alimentação","Transporte","Entretenimento","Roupas","Material Escolar","Compras","Saúde","Presentes","Tecnologia","Bar da escola","Outros"];
const CAT_ICONES={"Alimentação":"🍔","Transporte":"🚌","Entretenimento":"🎮","Roupas":"👕","Material Escolar":"📚","Compras":"🛍️","Saúde":"💊","Presentes":"🎁","Tecnologia":"💻","Bar da escola":"🧃","Outros":"✨"};
const CAT_CORES ={"Alimentação":"#FF6B6B","Transporte":"#4ECDC4","Entretenimento":"#96CEB4","Roupas":"#FFB347","Material Escolar":"#45B7D1","Compras":"#DDA0DD","Saúde":"#98FB98","Presentes":"#FFD700","Tecnologia":"#87CEEB","Bar da escola":"#FF8C42","Outros":"#00E676"};
const BAR_SUBCATS=["Salgados","Doces","Bebidas"];
const MESES=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const primeiroNome=(n)=>{if(!n||typeof n!=="string")return"Usuário";return n.split(" ")[0]||"Usuário";};

// ════════════════════════════════════════════════════════════════
//  🧠 PERFIL FINANCEIRO
// ════════════════════════════════════════════════════════════════
const PERGUNTAS=[
  {id:"q1",texto:"Quando recebo dinheiro, geralmente:",opcoes:[{t:"Gasto quase tudo rapidamente",p:1},{t:"Gasto uma parte e guardo outra",p:2},{t:"Guardo a maior parte antes de gastar",p:3}]},
  {id:"q2",texto:"Como descrevo meu controle financeiro:",opcoes:[{t:"Não tenho controle — gasto sem pensar",p:1},{t:"Tenho algum controle, mas erro às vezes",p:2},{t:"Acompanho tudo com cuidado",p:3}]},
  {id:"q3",texto:"Meus gastos com lazer e compras impulsivas:",opcoes:[{t:"São frequentes e difíceis de evitar",p:1},{t:"Acontecem às vezes, mas me arrependo depois",p:2},{t:"São raros — penso muito antes de gastar",p:3}]},
  {id:"q4",texto:"Quando tenho uma meta financeira:",opcoes:[{t:"Dificilmente consigo atingir",p:1},{t:"Às vezes consigo, com esforço",p:2},{t:"Costumo atingir — sou disciplinado(a)",p:3}]},
  {id:"q5",texto:"No mês passado, minha situação financeira foi:",opcoes:[{t:"Gastei mais do que recebi",p:1},{t:"Equilibrei mais ou menos",p:2},{t:"Consegui guardar dinheiro",p:3}]},
];
function calcularPerfil(respostas){
  const t=respostas.reduce((s,r)=>s+r,0);
  if(t<=7)  return{tipo:"Gastador",   emoji:"🔥",cor:"#ff4455",desc:"Você tende a gastar sem planejar. Pequenas mudanças de hábito farão grande diferença!"};
  if(t<=11) return{tipo:"Equilibrado",emoji:"⚖️",cor:"#FFB347",desc:"Você tem bom controle, mas ainda pode melhorar eliminando gastos impulsivos."};
  return        {tipo:"Econômico",  emoji:"💎",cor:"#00E676",desc:"Parabéns! Você tem excelente disciplina financeira. Continue assim!"};
}

// ════════════════════════════════════════════════════════════════
//  🔔 MOTOR DE NOTIFICAÇÕES
// ════════════════════════════════════════════════════════════════
function gerarNotificacoes(transacoes, metas, contas, saldoCents) {
  const notifs = [];
  const hoje   = new Date();
  const agora  = hoje.getTime();

  // ── 1. Contas a pagar ─────────────────────────────────────────
  contas.filter(c => !c.paga).forEach(c => {
    const venc  = new Date(c.vencimento + "T00:00:00");
    const dias  = Math.ceil((venc - hoje) / 86400000);
    const valor = fmt(c.valorCents);
    if (dias < 0) {
      notifs.push({ id:"conta_"+c.id, tipo:"perigo", icone:"🚨", titulo:"Conta vencida!", desc:`${c.nome} — ${valor} (venceu há ${Math.abs(dias)} dia${Math.abs(dias)>1?"s":""})`, prioridade:1, contaId:c.id });
    } else if (dias === 0) {
      notifs.push({ id:"conta_"+c.id, tipo:"perigo", icone:"❗", titulo:"Conta vence HOJE!", desc:`${c.nome} — ${valor}`, prioridade:1, contaId:c.id });
    } else if (dias <= 3) {
      notifs.push({ id:"conta_"+c.id, tipo:"alerta", icone:"⚠️", titulo:`Conta em ${dias} dia${dias>1?"s":""}`, desc:`${c.nome} — ${valor}`, prioridade:2, contaId:c.id });
    } else if (dias <= 7) {
      notifs.push({ id:"conta_"+c.id, tipo:"info",   icone:"📅", titulo:`Conta em ${dias} dias`, desc:`${c.nome} — ${valor}`, prioridade:3, contaId:c.id });
    }
  });

  // ── 2. Saldo negativo ─────────────────────────────────────────
  if (saldoCents < 0) {
    notifs.push({ id:"saldo_neg", tipo:"perigo", icone:"🔴", titulo:"Saldo negativo!", desc:`Seu saldo está em ${fmtSaldo(saldoCents)}. Evite novos gastos.`, prioridade:1 });
  }

  // ── 3. Metas próximas do prazo ────────────────────────────────
  metas.forEach(m => {
    if (!m.prazo) return;
    const venc = new Date(m.prazo + "T00:00:00");
    const dias = Math.ceil((venc - hoje) / 86400000);
    const alvoCents = m.valorAlvoCents || toCents(m.valorAlvo);
    const guardCents = m.valorGuardadoCents || toCents(m.valorGuardado);
    const pct = alvoCents > 0 ? guardCents / alvoCents : 0;
    if (dias > 0 && dias <= 7 && pct < 1) {
      notifs.push({ id:"meta_"+m.id, tipo:"alerta", icone:"🎯", titulo:`Meta expira em ${dias} dia${dias>1?"s":""}`, desc:`${m.nomeMeta}: ${Math.round(pct*100)}% concluída`, prioridade:2 });
    }
    if (pct >= 1) {
      notifs.push({ id:"metaok_"+m.id, tipo:"sucesso", icone:"🏆", titulo:"Meta atingida!", desc:`Parabéns! Você completou "${m.nomeMeta}"`, prioridade:4 });
    }
  });

  // ── 4. Gastos altos por categoria (mês atual) ─────────────────
  const mesAtual = hoje.getMonth(), anoAtual = hoje.getFullYear();
  const LIMITES = { "Alimentação":30000, "Entretenimento":15000, "Bar da escola":8000, "Compras":20000, "Roupas":15000 };
  Object.entries(LIMITES).forEach(([cat, limite]) => {
    const gasto = somarCents(transacoes.filter(t => {
      if (t.tipo !== "despesa" || t.categoria !== cat) return false;
      try { const d = new Date(t.data+"T00:00:00"); return d.getMonth()===mesAtual && d.getFullYear()===anoAtual; } catch { return false; }
    }).map(t => t.amountCents || toCents(t.amount)));
    if (gasto > limite) {
      notifs.push({ id:"gasto_"+cat, tipo:"alerta", icone:CAT_ICONES[cat]||"⚠️", titulo:`Gastos altos: ${cat}`, desc:`${fmt(gasto)} este mês (limite sugerido: ${fmt(limite)})`, prioridade:3 });
    }
  });

  // ── 5. Lembrete para registrar gastos ─────────────────────────
  const ultimaTx = transacoes.length > 0
    ? transacoes.reduce((a, b) => (a.criadoEm||"") > (b.criadoEm||"") ? a : b, transacoes[0])
    : null;
  if (ultimaTx) {
    const diffDias = Math.floor((agora - new Date(ultimaTx.criadoEm).getTime()) / 86400000);
    if (diffDias >= 5) {
      notifs.push({ id:"lembrete_tx", tipo:"info", icone:"📝", titulo:"Registre seus gastos!", desc:`Sua última transação foi há ${diffDias} dias. Mantenha o controle!`, prioridade:4 });
    }
  } else if (transacoes.length === 0) {
    notifs.push({ id:"lembrete_tx0", tipo:"info", icone:"📝", titulo:"Adicione sua primeira transação!", desc:"Comece a controlar suas finanças agora.", prioridade:4 });
  }

  // ordenar por prioridade (1 = mais urgente)
  return notifs.sort((a, b) => a.prioridade - b.prioridade);
}

const COR_NOTIF = { perigo:"#ff4455", alerta:"#FFB347", sucesso:"#00E676", info:"#45B7D1" };
const BG_NOTIF  = { perigo:"#ff445518", alerta:"#FFB34718", sucesso:"#00E67618", info:"#45B7D118" };


function construirContextoFinanceiro(transacoes, perfil) {
  const agora    = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const despMes = transacoes.filter(t=>{
    if(t.tipo!=="despesa") return false;
    try{const d=new Date(t.data+"T00:00:00");return d.getMonth()===mesAtual&&d.getFullYear()===anoAtual;}catch{return false;}
  });

  // Calcular em centavos — precisão garantida
  const receitasCents = somarCents(transacoes.filter(t=>t.tipo==="receita").map(t=>t.amountCents||toCents(t.amount)));
  const despesasCents = somarCents(transacoes.filter(t=>t.tipo==="despesa").map(t=>t.amountCents||toCents(t.amount)));
  const saldoCents    = receitasCents - despesasCents;
  const despMesCents  = somarCents(despMes.map(t=>t.amountCents||toCents(t.amount)));

  const gastoCatCents = (cat) => somarCents(despMes.filter(t=>t.categoria===cat).map(t=>t.amountCents||toCents(t.amount)));
  const topCats = CATEGORIAS.map(c=>({nome:c,cents:gastoCatCents(c)})).filter(c=>c.cents>0).sort((a,b)=>b.cents-a.cents);

  const ultimas = [...transacoes].sort((a,b)=>(b.data||"").localeCompare(a.data||"")).slice(0,8);

  return `
DADOS FINANCEIROS DO USUÁRIO (mês atual: ${MESES[mesAtual]}/${anoAtual}):

📊 RESUMO GERAL:
- Receitas totais: ${fmt(receitasCents)}
- Despesas totais: ${fmt(despesasCents)}
- Saldo atual: ${fmtSaldo(saldoCents)} (${saldoCents>=0?"positivo":"NEGATIVO"})
- Taxa de poupança: ${receitasCents>0?Math.round((saldoCents/receitasCents)*100):0}%

📅 GASTOS DO MÊS ATUAL (${MESES[mesAtual]}):
- Total gasto: ${fmt(despMesCents)}
- Número de transações: ${despMes.length}
${topCats.length>0?"Maiores categorias:\n"+topCats.slice(0,5).map(c=>`  • ${c.nome}: ${fmt(c.cents)}`).join("\n"):"- Sem despesas registradas este mês"}

🏷️ TOP CATEGORIAS DE GASTO (geral):
${CATEGORIAS.map(c=>{
  const cents=somarCents(transacoes.filter(t=>t.tipo==="despesa"&&t.categoria===c).map(t=>t.amountCents||toCents(t.amount)));
  return cents>0?`• ${c}: ${fmt(cents)}`:null;
}).filter(Boolean).slice(0,6).join("\n")||"Nenhuma despesa registrada"}

🧃 BAR DA ESCOLA (mês):
${(()=>{const b=gastoCatCents("Bar da escola");return b>0?`${fmt(b)} gastos (${b>8000?"ALTO - acima de R$80":"dentro do limite"})`:"-";})()}

🧠 PERFIL FINANCEIRO: ${perfil?`${perfil.emoji} ${perfil.tipo} — ${perfil.desc}`:"Não definido ainda"}

📋 ÚLTIMAS TRANSAÇÕES:
${ultimas.map(t=>`• ${t.data} | ${t.tipo==="receita"?"+":"-"}${fmt(t.amountCents||toCents(t.amount))} | ${t.categoria} | ${t.descricao||"sem descrição"}`).join("\n")||"Nenhuma transação"}
`.trim();
}

// ════════════════════════════════════════════════════════════════
//  🌐 CHAMADA À API DO CLAUDE (com fallback local)
// ════════════════════════════════════════════════════════════════
async function chamarClaudeAPI(mensagem, historico, transacoes, perfil) {
  const contexto = construirContextoFinanceiro(transacoes, perfil);

  const systemPrompt = `Você é o Atlas IA, assistente financeiro inteligente do aplicativo AtlasTrack, focado em ajudar estudantes do ensino médio a gerenciar suas finanças pessoais.

Seu tom é: amigável, direto, motivador e educativo. Use linguagem jovem mas profissional.

${contexto}

INSTRUÇÕES:
- Responda SEMPRE em português brasileiro
- Use os dados financeiros reais do usuário para personalizar cada resposta
- Formate com emojis relevantes para tornar a leitura mais agradável
- Use **negrito** para destacar valores e informações importantes
- Seja específico — mencione valores reais, categorias reais, padrões reais
- Se o saldo for negativo, alerte com empatia mas firmeza
- Se o perfil for "Gastador", ofereça dicas práticas e motivadoras
- Limite respostas a 200 palavras para manter o chat fluido
- Não invente dados que não estão no contexto acima`;

  const mensagensAPI = [
    ...historico.filter(m=>m.role!=="system").slice(-6).map(m=>({
      role: m.role==="ia"?"assistant":"user",
      content: m.texto
    })),
    { role:"user", content: mensagem }
  ];

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        model:"claude-sonnet-4-20250514",
        max_tokens:400,
        system: systemPrompt,
        messages: mensagensAPI,
      })
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const texto = data?.content?.find(b=>b.type==="text")?.text;
    if (!texto) throw new Error("Resposta vazia");
    return { texto, fonte:"claude" };
  } catch(e) {
    console.warn("Claude API indisponível, usando fallback:", e.message);
    return { texto: respostaLocal(mensagem, transacoes, perfil), fonte:"local" };
  }
}

// ════════════════════════════════════════════════════════════════
//  🔄 ATLAS IA — Respostas inteligentes baseadas nos dados reais
// ════════════════════════════════════════════════════════════════
function respostaLocal(mensagem, transacoes, perfil) {
  const msg=mensagem.toLowerCase().trim();
  const agora=new Date(), mesAtual=agora.getMonth(), anoAtual=agora.getFullYear();

  const despMes=transacoes.filter(t=>{
    if(t.tipo!=="despesa") return false;
    try{const d=new Date(t.data+"T00:00:00");return d.getMonth()===mesAtual&&d.getFullYear()===anoAtual;}catch{return false;}
  });
  const recMes=transacoes.filter(t=>{
    if(t.tipo!=="receita") return false;
    try{const d=new Date(t.data+"T00:00:00");return d.getMonth()===mesAtual&&d.getFullYear()===anoAtual;}catch{return false;}
  });

  const recCents    = somarCents(transacoes.filter(t=>t.tipo==="receita").map(t=>t.amountCents||toCents(t.amount)));
  const despCents   = somarCents(transacoes.filter(t=>t.tipo==="despesa").map(t=>t.amountCents||toCents(t.amount)));
  const saldoCents  = recCents - despCents;
  const despMesCents= somarCents(despMes.map(t=>t.amountCents||toCents(t.amount)));
  const recMesCents = somarCents(recMes.map(t=>t.amountCents||toCents(t.amount)));

  const gastoCat=(cat)=>somarCents(despMes.filter(t=>t.categoria===cat).map(t=>t.amountCents||toCents(t.amount)));
  const topCat=CATEGORIAS.map(c=>({nome:c,cents:gastoCat(c)})).sort((a,b)=>b.cents-a.cents).filter(c=>c.cents>0);
  const perfilTipo=perfil?.tipo||"Equilibrado";

  // Calcular gasto diário médio
  const diaDoMes=agora.getDate();
  const gastoDiario=diaDoMes>0?Math.round(despMesCents/diaDoMes):0;
  const diasNoMes=new Date(anoAtual,mesAtual+1,0).getDate();
  const diasRestantes=diasNoMes-diaDoMes;

  // ── SAUDAÇÕES ──────────────────────────────────────────────
  if(/(^(olá|oi|ola|hey|e aí|eai|hello|hi)$|bom dia|boa tarde|boa noite|tudo bem|tudo bom|como vai)/.test(msg)){
    const hora=agora.getHours();
    const saudacao=hora<12?"Bom dia":hora<18?"Boa tarde":"Boa noite";
    return `👋 ${saudacao}! Sou o **Atlas IA**, seu assistente financeiro pessoal.\n\nEstou aqui para te ajudar a entender seus gastos e tomar melhores decisões com o dinheiro. O que quer saber?\n\n💡 Pode me perguntar sobre: saldo, gastos do mês, bar da escola, metas, dicas de economia e seu perfil financeiro.`;
  }

  // ── SALDO ──────────────────────────────────────────────────
  if(/(saldo|quanto.*(tenho|sobrou|resta|tenho disponível)|meu dinheiro|dinheiro disponível)/.test(msg)){
    if(transacoes.length===0) return `💰 Você ainda não registrou nenhuma transação. Adicione suas receitas e despesas para eu calcular seu saldo!`;
    const taxa=recCents>0?Math.round((saldoCents/recCents)*100):0;
    if(saldoCents>=0)
      return `💚 Seu saldo atual é **${fmtSaldo(saldoCents)}**.\n\n• Receitas totais: ${fmt(recCents)}\n• Despesas totais: ${fmt(despCents)}\n• Taxa de poupança: ${taxa}%\n\n${taxa>=20?"🏆 Excelente! Você está poupando bem.":taxa>=10?"✅ Bom controle! Tente chegar em 20% de poupança.":"⚠️ Tente guardar pelo menos 20% do que recebe."}`;
    return `🔴 Seu saldo está **${fmtSaldo(saldoCents)}** (negativo).\n\nVocê gastou ${fmt(Math.abs(saldoCents))} a mais do que recebeu. Evite novos gastos e tente quitar essa diferença o quanto antes!`;
  }

  // ── SALDO SAUDÁVEL ─────────────────────────────────────────
  if(/(saldo.*(saudável|bom|ok|positivo)|financeiramente.*bem|indo bem|estou bem)/.test(msg)){
    if(saldoCents<0) return `🔴 Não está muito bem não. Seu saldo está **${fmtSaldo(saldoCents)}** — você gastou mais do que recebeu. Hora de agir!`;
    const taxa=recCents>0?Math.round((saldoCents/recCents)*100):0;
    if(taxa>=20) return `💎 Sim! Seu saldo está **${fmtSaldo(saldoCents)}** e você está poupando **${taxa}%** da sua renda. Isso é excelente para um estudante!`;
    if(taxa>=5)  return `✅ Razoável! Saldo de **${fmtSaldo(saldoCents)}** com **${taxa}%** de poupança. Você pode melhorar chegando a 20%!`;
    return `⚠️ Seu saldo é positivo (**${fmtSaldo(saldoCents)}**), mas a margem é pequena. Tente cortar alguns gastos para ter mais segurança.`;
  }

  // ── RESUMO / ANÁLISE ───────────────────────────────────────
  if(/(resumo|análise|analis|balanço|balanco|situação|situacao|como estou|minha situação)/.test(msg)){
    if(transacoes.length===0) return `📊 Ainda não tenho dados para analisar. Registre suas receitas e despesas primeiro!`;
    const taxa=recCents>0?Math.round((saldoCents/recCents)*100):0;
    const top=topCat[0];
    return `📊 **Resumo financeiro:**\n\n• Receitas: ${fmt(recCents)}\n• Despesas: ${fmt(despCents)}\n• Saldo: **${fmtSaldo(saldoCents)}**\n• Poupança: ${taxa}%\n${top?`• Maior gasto: ${top.nome} (${fmt(top.cents)})`:""  }\n\nPerfil: **${perfil?.emoji||""} ${perfilTipo}**\n${perfil?.desc||""}`;
  }

  // ── GASTANDO MUITO ─────────────────────────────────────────
  if(/(gastando muito|gasto.*alto|gasto.*demais|gasto excessivo|preciso cortar|to gastando)/.test(msg)){
    if(despMes.length===0) return `📅 Sem despesas registradas este mês — você está ótimo! Continue registrando tudo.`;
    const taxa=recMesCents>0?Math.round((despMesCents/recMesCents)*100):100;
    if(taxa>80) return `⚠️ Sim, você está gastando muito! **${taxa}%** da sua receita do mês já foi em despesas.\n\nMaiores gastos:\n${topCat.slice(0,3).map(c=>`• ${c.nome}: ${fmt(c.cents)}`).join("\n")}\n\nFoco: corte os gastos não essenciais primeiro.`;
    if(taxa>50) return `⚡ Atenção! Você já usou **${taxa}%** da sua receita este mês. Ainda dá pra controlar — evite gastos por impulso nos próximos dias.`;
    return `✅ Não! Você gastou **${taxa}%** da sua receita este mês, o que é razoável. Continue monitorando!`;
  }

  // ── CONTROLE DE GASTOS ─────────────────────────────────────
  if(/(controlar.*gasto|como.*controlar|como.*organizar|organizar.*financ|controle financeiro)/.test(msg)){
    return `🎯 **Como controlar seus gastos:**\n\n1. **Registre tudo** — até o menor gasto. O AtlasTrack foi feito pra isso!\n2. **Defina um limite** por categoria todo mês\n3. **Revise semanalmente** — veja onde está gastando mais\n4. **Crie metas** — ter um objetivo te motiva a economizar\n5. **Espere 24h** antes de qualquer compra por impulso\n\nO simples ato de registrar já muda o comportamento! 💪`;
  }

  // ── QUANTO POSSO GASTAR POR DIA ────────────────────────────
  if(/(quanto.*gastar.*dia|gasto.*diário|gasto diario|por dia|limite.*diário)/.test(msg)){
    if(saldoCents<=0) return `🔴 Seu saldo está negativo — evite qualquer gasto até equilibrar as contas!`;
    if(diasRestantes<=0) return `📅 Último dia do mês! Seu saldo disponível é **${fmt(saldoCents)}**.`;
    const porDia=Math.floor(saldoCents/diasRestantes);
    return `📅 Com seu saldo de **${fmt(saldoCents)}** e **${diasRestantes} dias** restantes no mês, você pode gastar até **${fmt(porDia)} por dia** sem entrar no negativo.\n\n💡 Mas tente guardar parte disso para o próximo mês!`;
  }

  // ── ECONOMIZAR / DICAS ─────────────────────────────────────
  if(/(como.*economizar|dica.*econom|econom|poupar|guardar dinheiro|gastar menos|cortar gasto)/.test(msg)){
    const dicas=[
      `💡 **Regra 50/30/20:** Divida sua renda em 50% necessidades, 30% desejos e 20% poupança. Simples e eficaz!`,
      `💡 **Espere 48h** antes de qualquer compra por impulso. Se depois de 2 dias você ainda quiser, aí compra.`,
      `💡 **Registre tudo no AtlasTrack** — até o cafezinho. Quem registra gasta menos, porque fica consciente!`,
      `💡 **Leve lanche de casa** em vez de comprar no bar da escola todo dia. Pode economizar mais de R$100 por mês!`,
      `💡 **Defina um limite mensal** para lazer e entretenimento e respeite ele. Diversão com controle!`,
      `💡 **Crie uma meta financeira** — ter um objetivo concreto (headphone, viagem, etc.) motiva muito mais a economizar.`,
      `💡 **Evite parcelamentos** — o "cabe no bolso" engana. Pague à vista ou não compre.`,
    ];
    return dicas[Math.floor(Math.random()*dicas.length)];
  }

  // ── ECONOMIZAR SENDO ESTUDANTE ─────────────────────────────
  if(/(estudante|sendo jovem|sendo estudante|jovem.*economizar|econom.*jovem)/.test(msg)){
    return `🎒 **Dicas para estudantes economizarem:**\n\n1. **Lanche de casa** — o bar da escola é conveniente mas caro\n2. **Carona e transporte coletivo** — evite aplicativos de corrida no dia a dia\n3. **Material escolar usado** — livros e materiais de colegas mais velhos\n4. **Meia-entrada** — use sempre que disponível em shows e cinemas\n5. **Trabalhe com o que tem** — pequenos bicos, venda de itens, freelance\n6. **Aproveite o que a escola oferece** — biblioteca, internet, impressão\n\nComeçar cedo a cuidar do dinheiro é o maior presente que você pode se dar! 💎`;
  }

  // ── COMPRAS IMPULSIVAS ─────────────────────────────────────
  if(/(impulso|impulsiv|compra.*impulso|evitar.*compra|resistir|tentação)/.test(msg)){
    return `🛑 **Como evitar compras por impulso:**\n\n• **Regra das 48h** — espere 2 dias antes de comprar qualquer coisa não planejada\n• **Saia sem cartão** — leve só o dinheiro que vai precisar\n• **Pergunte-se:** "Preciso disso ou só quero?"\n• **Pense no custo real** — quantas horas de mesada/trabalho isso representa?\n• **Delete apps de loja** do celular — menos tentação, menos gasto\n• **Tenha uma meta** — lembrar do objetivo te dá força para resistir\n\nO autocontrole financeiro é um músculo — quanto mais você exercita, mais forte fica! 💪`;
  }

  // ── BAR DA ESCOLA ──────────────────────────────────────────
  if(/(bar|cantina|bar da escola|lanche.*escola|escola.*lanche)/.test(msg)){
    const b=gastoCat("Bar da escola");
    const txBar=despMesCents>0?Math.round((b/despMesCents)*100):0;
    if(b===0) return `🧃 Você não tem gastos registrados no **Bar da escola** este mês. Ótimo controle!`;
    const status=b>8000?"⚠️ Está alto! Tente ficar abaixo de R$80,00 por mês.":b>4000?"⚡ Moderado. Tente reduzir um pouco.":"✅ Controlado! Bom trabalho.";
    return `🧃 **Bar da escola este mês:**\n\n• Total gasto: **${fmt(b)}**\n• % das despesas: ${txBar}%\n• Status: ${status}\n\n💡 Levar lanche de casa alguns dias pode economizar bastante no mês!`;
  }

  // ── GASTAR MENOS NO BAR ────────────────────────────────────
  if(/(menos.*bar|bar.*menos|reduzir.*bar|cortar.*bar|bar.*caro)/.test(msg)){
    const b=gastoCat("Bar da escola");
    return `🧃 ${b>0?`Você gastou **${fmt(b)}** no bar este mês. `:""}**Dicas para gastar menos no bar:**\n\n1. Leve água e um lanche de casa\n2. Defina um limite semanal (ex: R$20)\n3. Evite comprar por impulso quando estiver com fome\n4. Compare: R$5 por dia = R$100 por mês = R$1.200 por ano!\n\nPequenas mudanças geram grandes economias! 💰`;
  }

  // ── MAIOR GASTO ────────────────────────────────────────────
  if(/(maior.*gasto|gasto.*maior|gasto.*mais caro|mais caro|maior.*despesa)/.test(msg)){
    const todas=transacoes.filter(t=>t.tipo==="despesa").sort((a,b)=>(b.amountCents||toCents(b.amount))-(a.amountCents||toCents(a.amount)));
    if(todas.length===0) return `📊 Nenhuma despesa registrada ainda.`;
    const maior=todas[0];
    return `💸 Seu maior gasto foi **${fmt(maior.amountCents||toCents(maior.amount))}** em **${maior.categoria}**${maior.descricao?` (${maior.descricao})`:""}  no dia ${maior.data}.`;
  }

  // ── CATEGORIA QUE MAIS GASTA ───────────────────────────────
  if(/(categoria|mais.*gast|onde.*gast|mais.*caro)/.test(msg)){
    if(topCat.length===0) return `📂 Sem despesas registradas este mês ainda.`;
    return `📂 **Suas maiores categorias de gasto este mês:**\n\n${topCat.slice(0,4).map((c,i)=>`${i===0?"🥇":i===1?"🥈":i===2?"🥉":"  4."} ${c.nome}: **${fmt(c.cents)}**`).join("\n")}\n\n${topCat[0].cents>20000?`⚠️ **${topCat[0].nome}** está pesando bastante. Vale a pena revisar esses gastos!`:`✅ Seus gastos estão bem distribuídos.`}`;
  }

  // ── QUANTO GASTEI NO MÊS ───────────────────────────────────
  if(/(quanto.*gastei|gasto.*mês|gasto.*mes|este mês|esse mês|mensal|mês atual)/.test(msg)){
    if(despMes.length===0) return `📅 Nenhuma despesa registrada este mês ainda. Continue registrando tudo!`;
    return `📅 **Gastos de ${MESES[mesAtual]}:**\n\n• Total: **${fmt(despMesCents)}**\n• Transações: ${despMes.length}\n• Média diária: ${fmt(gastoDiario)}\n${topCat.length>0?`\nMaiores gastos:\n${topCat.slice(0,3).map(c=>`• ${c.nome}: ${fmt(c.cents)}`).join("\n")}`:""}`;
  }

  // ── QUANTO ECONOMIZEI ──────────────────────────────────────
  if(/(economi[sz]ei|quanto.*guard|poupança|quanto.*sobrou|sobra)/.test(msg)){
    if(recCents===0) return `💰 Adicione suas receitas primeiro para eu calcular quanto você economizou!`;
    const taxa=recCents>0?Math.round((saldoCents/recCents)*100):0;
    if(saldoCents<=0) return `😟 Este mês você não economizou — as despesas superaram as receitas em **${fmt(Math.abs(saldoCents))}**. Tente reduzir os gastos!`;
    return `💚 Você economizou **${fmt(saldoCents)}** — isso representa **${taxa}%** da sua receita.\n\n${taxa>=20?"🏆 Parabéns! Isso é excelente.":taxa>=10?"✅ Bom resultado! Tente chegar em 20%.":"💪 É um começo! Tente aumentar essa porcentagem."}`;
  }



  // ── GASTO AUMENTOU OU DIMINUIU ─────────────────────────────
  if(/(aumentou|diminuiu|comparado|mês passado|mes passado|evolução|evolucao|tendência)/.test(msg)){
    const mesAnt=mesAtual===0?11:mesAtual-1;
    const anoAnt=mesAtual===0?anoAtual-1:anoAtual;
    const despAnt=somarCents(transacoes.filter(t=>{
      if(t.tipo!=="despesa") return false;
      try{const d=new Date(t.data+"T00:00:00");return d.getMonth()===mesAnt&&d.getFullYear()===anoAnt;}catch{return false;}
    }).map(t=>t.amountCents||toCents(t.amount)));
    if(despAnt===0) return `📈 Não tenho dados do mês passado para comparar. Continue registrando e em breve terei!`;
    const diff=despMesCents-despAnt;
    const pct=Math.round((Math.abs(diff)/despAnt)*100);
    if(diff>0) return `📈 Seus gastos **aumentaram ${pct}%** em relação ao mês passado.\n\n• Mês passado: ${fmt(despAnt)}\n• Este mês: ${fmt(despMesCents)}\n• Diferença: +${fmt(diff)}\n\n⚠️ Fique atento para não continuar essa tendência!`;
    if(diff<0) return `📉 Seus gastos **diminuíram ${pct}%** em relação ao mês passado!\n\n• Mês passado: ${fmt(despAnt)}\n• Este mês: ${fmt(despMesCents)}\n• Economia: ${fmt(Math.abs(diff))}\n\n🎉 Parabéns! Continue assim!`;
    return `📊 Seus gastos estão **iguais** ao mês passado: ${fmt(despMesCents)}. Tente reduzir!`;
  }

  // ── PERFIL FINANCEIRO ──────────────────────────────────────
  if(/(perfil|meu.*tipo|tipo.*financeiro|como.*classificado|sou gastador|sou econômico)/.test(msg)){
    if(!perfil) return `🧠 Você ainda não fez o questionário de perfil financeiro. Ele aparecerá automaticamente na próxima vez que você abrir o app!`;
    return `🧠 **Seu perfil financeiro:**\n\n${perfil.emoji} **${perfil.tipo}**\n\n${perfil.desc}\n\n💡 O questionário se repete a cada 30 dias para acompanhar sua evolução!`;
  }

  // ── O QUE SIGNIFICA CADA PERFIL ────────────────────────────
  if(/(o que.*significa|significa.*perfil|econômico.*significa|gastador.*significa|equilibrado.*significa)/.test(msg)){
    return `🧠 **Os 3 perfis financeiros:**\n\n🔥 **Gastador** — Tende a gastar sem planejar. Precisa de mais controle e disciplina.\n\n⚖️ **Equilibrado** — Tem bom controle mas ainda comete excessos às vezes.\n\n💎 **Econômico** — Excelente disciplina financeira. Planeja, poupa e controla bem.\n\nO objetivo é evoluir para **Econômico** com o tempo!`;
  }

  // ── MELHORAR PERFIL ────────────────────────────────────────
  if(/(melhorar.*perfil|virar.*econômico|ser.*econômico|mudar.*perfil|como melhorar)/.test(msg)){
    return `💎 **Como melhorar seu perfil financeiro:**\n\n1. **Registre tudo** — consciência é o primeiro passo\n2. **Defina limites** por categoria todo mês\n3. **Poupe antes de gastar** — separe 20% assim que receber\n4. **Evite parcelamentos** — eles escondem o real valor gasto\n5. **Revise suas metas** semanalmente\n6. **Refaça o questionário** em 30 dias para ver sua evolução\n\nMudança de hábito leva tempo, mas vale a pena! 💪`;
  }

  // ── METAS ──────────────────────────────────────────────────
  if(/(meta|objetivo|sonho|quanto falta|perto.*meta|meta.*perto|atingir.*meta)/.test(msg)){
    if(transacoes.length===0) return `🎯 Crie suas metas na aba **Metas** do app! Ter um objetivo concreto te motiva muito mais a economizar.`;
    return `🎯 Acesse a aba **Metas** para ver o progresso detalhado de cada objetivo.\n\n💡 Dica: divida o valor que falta pelos dias até o prazo para saber quanto guardar por dia!`;
  }

  // ── QUANTO GUARDAR POR SEMANA ──────────────────────────────
  if(/(quanto.*guardar|guardar.*semana|guardar.*dia|poupar.*semana|poupar.*dia)/.test(msg)){
    if(saldoCents<=0) return `😟 Seu saldo está negativo — primeiro equilibre as contas antes de pensar em poupar!`;
    const porSemana=Math.floor(saldoCents/4);
    const porDia2=Math.floor(saldoCents/30);
    return `💰 Com seu saldo atual de **${fmt(saldoCents)}**, você poderia guardar:\n\n• **${fmt(porDia2)} por dia**\n• **${fmt(porSemana)} por semana**\n\nO ideal é guardar pelo menos 20% da sua renda mensal assim que receber!`;
  }

  // ── SAUDAÇÃO FINAL / NÃO ENTENDEU ─────────────────────────
  if(topCat.length>0){
    return `🤖 Não entendi bem a pergunta, mas posso te ajudar com:\n\n• **Saldo** — quanto você tem disponível\n• **Gastos do mês** — quanto gastou em ${MESES[mesAtual]}\n• **Bar da escola** — seus gastos lá\n• **Dicas** — como economizar mais\n• **Perfil** — seu tipo financeiro\n• **Metas** — progresso dos seus objetivos\n\nSeu maior gasto este mês é **${topCat[0].nome}** (${fmt(topCat[0].cents)}). Quer saber mais sobre isso?`;
  }
  return `🤖 Olá! Sou o **Atlas IA**. Ainda não tenho seus dados financeiros para analisar.\n\nComece adicionando suas receitas e despesas e depois volte aqui — terei muito mais para te contar! 😊`;
}

// ════════════════════════════════════════════════════════════════
//  📊 DADOS DE DEMONSTRAÇÃO (em centavos)
// ════════════════════════════════════════════════════════════════
function popularDemo(userId) {
  try {
    const ag=new Date(), ano=ag.getFullYear(), mes=ag.getMonth();
    const txs=DB.transacoes();
    // amountCents: valores em centavos (inteiros) — zero erro de ponto flutuante
    [
      {amountCents:120000,tipo:"receita",categoria:"Outros",        descricao:"Mesada mensal",           data:new Date(ano,mes,1).toISOString().slice(0,10)},
      {amountCents:4550,  tipo:"despesa",categoria:"Alimentação",   descricao:"Almoço na escola",        data:new Date(ano,mes,3).toISOString().slice(0,10)},
      {amountCents:2800,  tipo:"despesa",categoria:"Transporte",    descricao:"Passe de ônibus",         data:new Date(ano,mes,5).toISOString().slice(0,10)},
      {amountCents:8990,  tipo:"despesa",categoria:"Material Escolar",descricao:"Cadernos e canetas",   data:new Date(ano,mes,7).toISOString().slice(0,10)},
      {amountCents:3500,  tipo:"despesa",categoria:"Entretenimento",descricao:"Netflix + Spotify",       data:new Date(ano,mes,10).toISOString().slice(0,10)},
      {amountCents:20000, tipo:"receita",categoria:"Outros",        descricao:"Presente de aniversário", data:new Date(ano,mes,12).toISOString().slice(0,10)},
      {amountCents:1500,  tipo:"despesa",categoria:"Bar da escola", descricao:"Lanche — Salgados",       data:new Date(ano,mes,13).toISOString().slice(0,10),subcat:"Salgados"},
      {amountCents:6730,  tipo:"despesa",categoria:"Roupas",        descricao:"Camiseta nova",           data:new Date(ano,mes,15).toISOString().slice(0,10)},
      {amountCents:1000,  tipo:"despesa",categoria:"Bar da escola", descricao:"Bebidas — Suco",          data:new Date(ano,mes,16).toISOString().slice(0,10),subcat:"Bebidas"},
      {amountCents:2200,  tipo:"despesa",categoria:"Alimentação",   descricao:"Lanches",                 data:new Date(ano,mes,18).toISOString().slice(0,10)},
      {amountCents:4990,  tipo:"despesa",categoria:"Tecnologia",    descricao:"App de música anual",     data:new Date(ano,mes,20).toISOString().slice(0,10)},
    ].forEach(d=>txs.push({id:DB.uid(),userId,...d,criadoEm:new Date().toISOString()}));
    DB.salvarTransacoes(txs);
    const metas=DB.metas();
    metas.push({id:DB.uid(),userId,nomeMeta:"Notebook Novo",    valorAlvoCents:250000,valorGuardadoCents:45000,prazo:new Date(ano,mes+4,1).toISOString().slice(0,10),criadoEm:new Date().toISOString()});
    metas.push({id:DB.uid(),userId,nomeMeta:"Festa de Formatura",valorAlvoCents:80000,valorGuardadoCents:32000,prazo:new Date(ano,mes+2,1).toISOString().slice(0,10),criadoEm:new Date().toISOString()});
    DB.salvarMetas(metas);
    const perfis=DB.perfis();
    perfis.push({userId,...calcularPerfil([2,2,2,2,2]),respondidoEm:new Date().toISOString()});
    DB.salvarPerfis(perfis);
  } catch(e){console.error(e);}
}

// ════════════════════════════════════════════════════════════════
//  📈 COMPONENTES VISUAIS
// ════════════════════════════════════════════════════════════════
function GraficoBarras({data=[],cor="#00E676",altura=80}){
  if(!data.length) return <div style={{height:altura}}/>;
  const max=Math.max(...data.map(d=>d.valor||0),1);
  return(
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:altura,width:"100%"}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4,height:"100%"}}>
          <div style={{flex:1,display:"flex",alignItems:"flex-end",width:"100%"}}>
            <div style={{width:"100%",background:cor,borderRadius:"4px 4px 0 0",height:`${Math.max(((d.valor||0)/max)*100,(d.valor||0)>0?6:0)}%`,transition:"height 0.6s cubic-bezier(.34,1.56,.64,1)",opacity:0.65+0.35*((d.valor||0)/max)}}/>
          </div>
          <span style={{fontSize:9,color:"#666",whiteSpace:"nowrap"}}>{d.rotulo}</span>
        </div>
      ))}
    </div>
  );
}

function GraficoRosca({segmentos=[],tamanho=140}){
  const total=segmentos.reduce((s,x)=>s+(x.valor||0),0);
  if(!total) return <div style={{width:tamanho,height:tamanho,borderRadius:"50%",background:"#1e1e1e",margin:"0 auto"}}/>;
  let ac=0;
  return(
    <svg width={tamanho} height={tamanho} style={{display:"block",margin:"0 auto"}}>
      {segmentos.map((seg,i)=>{
        const pct=(seg.valor||0)/total,ini=ac;ac+=pct;
        const a1=(ini-0.25)*2*Math.PI,a2=(ac-0.25)*2*Math.PI;
        const r=tamanho/2-10,cx=tamanho/2,cy=tamanho/2;
        const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1),x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
        return <path key={i} d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${pct>0.5?1:0},1 ${x2},${y2} Z`} fill={seg.cor||"#555"} stroke="#121212" strokeWidth={2}/>;
      })}
      <circle cx={tamanho/2} cy={tamanho/2} r={tamanho/2-28} fill="#121212"/>
      <text x={tamanho/2} y={tamanho/2-4} textAnchor="middle" fill="#00E676" fontSize={13} fontWeight="bold">{segmentos.length}</text>
      <text x={tamanho/2} y={tamanho/2+14} textAnchor="middle" fill="#666" fontSize={9}>categorias</text>
    </svg>
  );
}

function Anel({pct=0,tam=60,traco=6,cor="#00E676"}){
  const r=(tam-traco)/2,c=2*Math.PI*r,p=isNaN(pct)?0:Math.min(Math.max(pct,0),1);
  return(
    <svg width={tam} height={tam}>
      <circle cx={tam/2} cy={tam/2} r={r} fill="none" stroke="#1e1e1e" strokeWidth={traco}/>
      <circle cx={tam/2} cy={tam/2} r={r} fill="none" stroke={cor} strokeWidth={traco}
        strokeDasharray={`${c*p} ${c}`} strokeLinecap="round"
        transform={`rotate(-90 ${tam/2} ${tam/2})`} style={{transition:"stroke-dasharray 0.8s ease"}}/>
      <text x={tam/2} y={tam/2+4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight="bold">{Math.round(p*100)}%</text>
    </svg>
  );
}

// Renderiza **negrito** e quebras de linha do markdown simples
function TextoIA({texto=""}){
  return(
    <span style={{display:"block",lineHeight:1.65,fontSize:13.5}}>
      {texto.split("\n").map((l,i)=>(
        <span key={i} style={{display:"block",marginBottom:l===""?6:2}}>
          {l.split(/\*\*(.*?)\*\*/g).map((p,j)=>j%2===1?<strong key={j}>{p}</strong>:<span key={j}>{p}</span>)}
        </span>
      ))}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════
//  🎨 ESTILOS BASE
// ════════════════════════════════════════════════════════════════
const S={
  app:     {background:"#121212",minHeight:"100vh",maxWidth:430,margin:"0 auto",fontFamily:"'DM Sans',system-ui,sans-serif",color:"#fff",position:"relative"},
  tela:    {padding:"0 0 90px",minHeight:"100vh"},
  cab:     {padding:"50px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"},
  card:    {background:"#1a1a1a",borderRadius:20,padding:20,marginBottom:16},
  dest:    {background:"linear-gradient(135deg,#00E676,#00C853)",borderRadius:24,padding:24,marginBottom:16,color:"#000"},
  inp:     {width:"100%",background:"#1e1e1e",border:"1.5px solid #2a2a2a",borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"inherit",transition:"border-color 0.2s"},
  rot:     {fontSize:11,color:"#666",fontWeight:700,letterSpacing:0.8,textTransform:"uppercase",display:"block",marginBottom:6},
  btn:     {width:"100%",background:"#00E676",border:"none",borderRadius:14,padding:"15px",color:"#000",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"inherit"},
  btnSm:   {background:"#00E676",border:"none",borderRadius:10,padding:"8px 14px",color:"#000",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"},
  btnG:    {background:"transparent",border:"1.5px solid #2a2a2a",borderRadius:10,padding:"8px 14px",color:"#888",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"},
  nav:     {position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"#0a0a0a",borderTop:"1px solid #1e1e1e",display:"flex",zIndex:100,paddingBottom:4},
  navB:    (a)=>({flex:1,padding:"10px 0 6px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",color:a?"#00E676":"#3a3a3a",transition:"color 0.2s",fontFamily:"inherit"}),
  chip:    (a)=>({padding:"7px 13px",borderRadius:20,border:"1.5px solid",borderColor:a?"#00E676":"#2a2a2a",background:a?"#00E67622":"transparent",color:a?"#00E676":"#666",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit",flexShrink:0}),
  badge:   (t)=>({background:t==="receita"?"#00E67622":"#ff445522",color:t==="receita"?"#00E676":"#ff6666",borderRadius:8,padding:"3px 9px",fontSize:11,fontWeight:700}),
  row:     {display:"flex",justifyContent:"space-between",alignItems:"center"},
  sep:     {height:1,background:"#222",margin:"8px 0"},
  erro:    {color:"#ff6b6b",fontSize:13,textAlign:"center",padding:"6px 0"},
  toast:   (ok)=>({position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:ok?"#00E676":"#ff6b6b",color:"#000",padding:"12px 22px",borderRadius:40,fontWeight:700,fontSize:14,zIndex:999,whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(0,0,0,0.5)",pointerEvents:"none"}),
  fi:      (e)=>{e.target.style.borderColor="#00E676";},
  fo:      (e)=>{e.target.style.borderColor="#2a2a2a";},
  notifBadge: {position:"absolute",top:4,right:4,background:"#ff4455",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:"#fff",pointerEvents:"none"},
};

// ════════════════════════════════════════════════════════════════
//  🚀 APP
// ════════════════════════════════════════════════════════════════
export default function AtlasTrack(){
  const [usuario,    setUsuario]   =useState(()=>{try{const t=localStorage.getItem("atv3_token");return t?lerJWT(t):null;}catch{return null;}});
  const [telAuth,    setTelAuth]   =useState("login");
  const [aba,        setAba]       =useState("painel");
  const [aviso,      setAviso]     =useState(null);
  const [carregando, setCarregando]=useState(false);
  const [formAuth,   setFormAuth]  =useState({nome:"",email:"",senha:""});
  const [erroAuth,   setErroAuth]  =useState("");

  // Perfil
  const [mostrarQ,setMostrarQ]=useState(false);
  const [etapaQ,  setEtapaQ]  =useState(0);
  const [respQ,   setRespQ]   =useState([]);
  const [perfil,  setPerfil]  =useState(null);

  // Transações — input em reais (string), salvo em centavos
  const [inputValor, setInputValor]=useState("");
  const [formTx, setFormTx]=useState({tipo:"despesa",categoria:"Alimentação",descricao:"",data:new Date().toISOString().slice(0,10),subcat:""});

  // Metas — inputs em reais (string), salvo em centavos
  const [inputAlvo,     setInputAlvo]    =useState("");
  const [inputGuardado, setInputGuardado]=useState("");
  const [formMeta, setFormMeta]=useState({nomeMeta:"",prazo:""});
  const [editarMeta,setEditarMeta]=useState(null);

  // Filtros
  const [filtroCategoria,setFiltroCategoria]=useState("Todas");
  const [filtroData,     setFiltroData]     =useState("");
  const [filtroTipo,     setFiltroTipo]     =useState("Todos");

  // Dados
  const [transacoes,setTransacoes]=useState([]);
  const [metas,     setMetas]     =useState([]);
  const [contas,    setContas]    =useState([]);   // contas a pagar

  // Notificações
  const [notificacoes,   setNotificacoes]   =useState([]);
  const [abaNotif,       setAbaNotif]       =useState(false);  // drawer aberto?
  const [popupInicial,   setPopupInicial]   =useState(false);  // popup ao abrir

  // Contas a pagar — form
  const [formConta, setFormConta]=useState({nome:"",valorStr:"",vencimento:"",recorrente:false,categoria:"Outros"});
  const [editarConta,setEditarConta]=useState(null);

  // Atlas IA
  const [msgIA,  setMsgIA] =useState("");
  const [chatIA, setChatIA]=useState([]);
  const [digIA,  setDigIA] =useState(false);
  const [fonteIA,setFonteIA]=useState("claude"); // "claude" | "local"
  const chatRef=useRef(null);

  // Tour de apresentação
  const [tourAtivo,  setTourAtivo]  =useState(false);
  const [tourEtapa,  setTourEtapa]  =useState(0);
  const [tourNovoReg,setTourNovoReg]=useState(false); // flag para disparar tour pós-cadastro

  const mostrarAviso=(msg,ok=true)=>{setAviso({msg,ok});setTimeout(()=>setAviso(null),2800);};

  const carregarDados=useCallback(async(uid)=>{
    try{
      let txs, mts, cnts, perf;
      if(supabase){
        const [rTx,rMt,rCn,rPf]=await Promise.all([
          supabase.from("transacoes").select("*").eq("user_id",uid),
          supabase.from("metas").select("*").eq("user_id",uid),
          supabase.from("contas").select("*").eq("user_id",uid),
          supabase.from("perfis").select("*").eq("user_id",uid).maybeSingle(),
        ]);
        txs  = (rTx.data||[]).map(t=>({...t,userId:t.user_id,amountCents:t.amount_cents}));
        mts  = (rMt.data||[]).map(m=>({...m,userId:m.user_id,nomeMeta:m.nome_meta,valorAlvoCents:m.valor_alvo_cents,valorGuardadoCents:m.valor_guardado_cents}));
        cnts = (rCn.data||[]).map(c=>({...c,userId:c.user_id,valorCents:c.valor_cents,pagaEm:c.paga_em}));
        perf = rPf.data ? {...rPf.data,userId:rPf.data.user_id,respondidoEm:rPf.data.respondido_em,descricao:rPf.data.descricao} : null;
        DB.salvarTransacoes([...DB.transacoes().filter(t=>t.userId!==uid),...txs]);
        DB.salvarMetas([...DB.metas().filter(m=>m.userId!==uid),...mts]);
        DB.salvarContas([...DB.contas().filter(c=>c.userId!==uid),...cnts]);
        if(perf){const ps=DB.perfis().filter(p=>p.userId!==uid);ps.push(perf);DB.salvarPerfis(ps);}
      } else {
        txs  = DB.txDoUsuario(uid);
        mts  = DB.metasDoUsuario(uid);
        cnts = DB.contasDoUsuario(uid);
        perf = DB.perfilDoUsuario(uid);
      }
      setTransacoes(txs); setMetas(mts); setContas(cnts);
      if(perf) setPerfil(perf);
      const rec  = somarCents(txs.filter(t=>t.tipo==="receita").map(t=>t.amountCents||toCents(t.amount)));
      const desp = somarCents(txs.filter(t=>t.tipo==="despesa").map(t=>t.amountCents||toCents(t.amount)));
      setNotificacoes(gerarNotificacoes(txs, mts, cnts, rec-desp));
    }catch(e){console.error("carregarDados:",e);}
  },[]);

  useEffect(()=>{
    if(usuario?.id){
      carregarDados(usuario.id);
      const perf=DB.perfilDoUsuario(usuario.id);
      if(!perf){
        // Novo usuário: inicia tour — o questionário virá só ao final do tour
        if(tourNovoReg){
          setTourNovoReg(false);
          setTourEtapa(0);
          setTourAtivo(true);
        } else if(!tourAtivo) {
          // Voltou sem ter feito o perfil (ex: pulou o tour e reabriu)
          setMostrarQ(true);
        }
      } else {
        // Mostrar questionário a cada 30 dias
        const ultima=new Date(perf.respondidoEm||0);
        const diasPassados=Math.floor((Date.now()-ultima.getTime())/86400000);
        if(diasPassados>=30) setMostrarQ(true);
      }
    }
  },[usuario,carregarDados,tourNovoReg]);

  // Popup de notificações urgentes ao abrir o app
  useEffect(()=>{
    if(notificacoes.some(n=>n.tipo==="perigo") && !abaNotif){
      const timer=setTimeout(()=>setPopupInicial(true),800);
      return()=>clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[notificacoes.length]);

  useEffect(()=>{
    if(chatRef.current) chatRef.current.scrollTop=chatRef.current.scrollHeight;
  },[chatIA,digIA]);

  // ── AUTH ────────────────────────────────────────────────────
  const registrar=async()=>{
    setErroAuth(""); setCarregando(true);
    try{
      const nome=san(formAuth.nome), email=san(formAuth.email).toLowerCase(), senha=formAuth.senha;
      if(!nome||!email||!senha){setErroAuth("Todos os campos são obrigatórios");return;}
      if(nome.length<2){setErroAuth("Nome muito curto");return;}
      if(!validarEmail(email)){setErroAuth("E-mail inválido");return;}
      if(senha.length<6){setErroAuth("Senha deve ter mínimo 6 caracteres");return;}
      const senhaCript=await hashSenha(senha);
      let novoId=DB.uid();
      if(supabase){
        // Verificar email duplicado no Supabase
        const {data:existe}=await supabase.from("usuarios").select("id").eq("email",email).maybeSingle();
        if(existe){setErroAuth("E-mail já cadastrado");return;}
        const {data:criado,error:errCriar}=await supabase.from("usuarios").insert({id:novoId,nome,email,senha:senhaCript}).select().single();
        if(errCriar){console.error("Supabase registrar error:",errCriar);setErroAuth("Erro: "+errCriar.message);return;}
        novoId=criado.id;
      } else {
        const usuarios=DB.usuarios();
        if(usuarios.find(u=>u.email===email)){setErroAuth("E-mail já cadastrado");return;}
        const novo={id:novoId,nome,email,senha:senhaCript,criadoEm:new Date().toISOString()};
        usuarios.push(novo); DB.salvarUsuarios(usuarios);
      }
      const t=criarJWT({id:novoId,nome,email});
      localStorage.setItem("atv3_token",t); setUsuario(lerJWT(t));
      setTourNovoReg(true);
    }catch(e){console.error("registrar catch:",e);setErroAuth("Erro ao criar conta: "+e.message);}finally{setCarregando(false);}
  };

  const entrar=async()=>{
    setErroAuth(""); setCarregando(true);
    try{
      const email=san(formAuth.email).toLowerCase(), senha=formAuth.senha;
      if(!email||!senha){setErroAuth("Preencha e-mail e senha");return;}
      if(!validarEmail(email)){setErroAuth("E-mail inválido");return;}
      let enc;
      if(supabase){
        const {data,error}=await supabase.from("usuarios").select("*").eq("email",email).maybeSingle();
        if(error||!data){setErroAuth("Conta não encontrada");return;}
        enc=data; enc.nome=enc.nome; // já correto
      } else {
        enc=DB.usuarios().find(u=>u.email===email);
        if(!enc){setErroAuth("Conta não encontrada");return;}
      }
      if(!await verificarSenha(senha,enc.senha)){setErroAuth("Senha incorreta");return;}
      const t=criarJWT({id:enc.id,nome:enc.nome,email:enc.email});
      localStorage.setItem("atv3_token",t); setUsuario(lerJWT(t));
    }catch{setErroAuth("Erro ao entrar.");}finally{setCarregando(false);}
  };

  const sair=()=>{
    localStorage.removeItem("atv3_token");
    setUsuario(null); setTransacoes([]); setMetas([]); setContas([]); setPerfil(null);
    setNotificacoes([]); setAbaNotif(false); setPopupInicial(false);
    setFormAuth({nome:"",email:"",senha:""}); setTelAuth("login"); setAba("painel");
    setChatIA([]); setMostrarQ(false); setEtapaQ(0); setRespQ([]);
  };

  // ── PERFIL ──────────────────────────────────────────────────
  const responderQ=async(pontos)=>{
    const novas=[...respQ,pontos];
    if(etapaQ+1>=PERGUNTAS.length){
      const resultado=calcularPerfil(novas);
      const agora=new Date().toISOString();
      if(supabase){
        await supabase.from("perfis").upsert({user_id:usuario.id,tipo:resultado.tipo,emoji:resultado.emoji,cor:resultado.cor,descricao:resultado.desc,respondido_em:agora},{onConflict:"user_id"});
      }
      const perfis=DB.perfis().filter(p=>p.userId!==usuario.id);
      perfis.push({userId:usuario.id,...resultado,respondidoEm:agora});
      DB.salvarPerfis(perfis); setPerfil(resultado);
      setMostrarQ(false); setEtapaQ(0); setRespQ([]);
      mostrarAviso(`Perfil: ${resultado.emoji} ${resultado.tipo}!`);
    }else{ setRespQ(novas); setEtapaQ(etapaQ+1); }
  };

  // ── TRANSAÇÕES ───────────────────────────────────────────────
  const adicionarTransacao=async(valorCentsOverride=null,subcatOverride=null)=>{
    // Converter input de reais para centavos com Math.round — elimina flutuação
    const cents=valorCentsOverride!==null ? valorCentsOverride : toCents(inputValor);
    if(!cents||cents<=0){mostrarAviso("Informe um valor válido",false);return;}
    const cat=formTx.categoria;
    const desc=san(subcatOverride||formTx.descricao);
    if(cat==="Outros"&&!desc){mostrarAviso("Descrição obrigatória para 'Outros'",false);return;}
    const novoId=DB.uid();
    const novaData=formTx.data; const novaCat=cat; const novaDesc=desc; const novaSubcat=san(formTx.subcat||"");
    if(supabase){
      await supabase.from("transacoes").insert({id:novoId,user_id:usuario.id,amount_cents:cents,tipo:formTx.tipo,categoria:novaCat,descricao:novaDesc,subcat:novaSubcat,data:novaData});
    }
    const txs=DB.transacoes();
    txs.push({id:novoId,userId:usuario.id,amountCents:cents,tipo:formTx.tipo,categoria:novaCat,descricao:novaDesc,subcat:novaSubcat,data:novaData,criadoEm:new Date().toISOString()});
    DB.salvarTransacoes(txs); carregarDados(usuario.id);
    setInputValor(""); setFormTx({tipo:"despesa",categoria:"Alimentação",descricao:"",data:new Date().toISOString().slice(0,10),subcat:""});
    mostrarAviso("Transação adicionada! ✓"); setAba("painel");
  };

  const excluirTx=async(id)=>{
    const tx=DB.transacoes().find(t=>t.id===id);
    if(!tx||tx.userId!==usuario.id){mostrarAviso("Não autorizado",false);return;}
    if(supabase) await supabase.from("transacoes").delete().eq("id",id).eq("user_id",usuario.id);
    DB.salvarTransacoes(DB.transacoes().filter(t=>t.id!==id)); carregarDados(usuario.id);
    mostrarAviso("Transação removida");
  };

  // ── METAS ───────────────────────────────────────────────────
  const salvarMeta=async()=>{
    const nome=san(formMeta.nomeMeta);
    const alvoCents=toCents(inputAlvo);
    if(!nome||!alvoCents){mostrarAviso("Nome e valor alvo obrigatórios",false);return;}
    const guardadoCents=toCents(inputGuardado)||0;
    const ms=DB.metas();
    if(editarMeta){
      if(supabase) await supabase.from("metas").update({nome_meta:nome,valor_alvo_cents:alvoCents,valor_guardado_cents:guardadoCents,prazo:formMeta.prazo||null}).eq("id",editarMeta.id).eq("user_id",usuario.id);
      const idx=ms.findIndex(m=>m.id===editarMeta.id&&m.userId===usuario.id);
      if(idx>=0) ms[idx]={...ms[idx],nomeMeta:nome,valorAlvoCents:alvoCents,valorGuardadoCents:guardadoCents,prazo:formMeta.prazo};
    }else{
      const novoId=DB.uid();
      if(supabase) await supabase.from("metas").insert({id:novoId,user_id:usuario.id,nome_meta:nome,valor_alvo_cents:alvoCents,valor_guardado_cents:guardadoCents,prazo:formMeta.prazo||null});
      ms.push({id:novoId,userId:usuario.id,nomeMeta:nome,valorAlvoCents:alvoCents,valorGuardadoCents:guardadoCents,prazo:formMeta.prazo,criadoEm:new Date().toISOString()});
    }
    DB.salvarMetas(ms); carregarDados(usuario.id);
    const era=!!editarMeta;
    setFormMeta({nomeMeta:"",prazo:""}); setInputAlvo(""); setInputGuardado(""); setEditarMeta(null);
    mostrarAviso(era?"Meta atualizada! ✓":"Meta criada! ✓"); setAba("metas");
  };

  const excluirMeta=async(id)=>{
    const m=DB.metas().find(x=>x.id===id);
    if(!m||m.userId!==usuario.id){mostrarAviso("Não autorizado",false);return;}
    if(supabase) await supabase.from("metas").delete().eq("id",id).eq("user_id",usuario.id);
    DB.salvarMetas(DB.metas().filter(x=>x.id!==id)); carregarDados(usuario.id);
    mostrarAviso("Meta removida");
  };

  // ── CONTAS A PAGAR ────────────────────────────────────────────
  const salvarConta=async()=>{
    const nome=san(formConta.nome);
    const valorCents=toCents(formConta.valorStr);
    if(!nome){mostrarAviso("Nome da conta obrigatório",false);return;}
    if(!valorCents||valorCents<=0){mostrarAviso("Valor inválido",false);return;}
    if(!formConta.vencimento){mostrarAviso("Data de vencimento obrigatória",false);return;}
    const cs=DB.contas();
    if(editarConta){
      if(supabase) await supabase.from("contas").update({nome,valor_cents:valorCents,vencimento:formConta.vencimento,recorrente:formConta.recorrente,categoria:formConta.categoria}).eq("id",editarConta.id).eq("user_id",usuario.id);
      const idx=cs.findIndex(c=>c.id===editarConta.id&&c.userId===usuario.id);
      if(idx>=0) cs[idx]={...cs[idx],nome,valorCents,vencimento:formConta.vencimento,recorrente:formConta.recorrente,categoria:formConta.categoria};
    }else{
      const novoId=DB.uid();
      if(supabase) await supabase.from("contas").insert({id:novoId,user_id:usuario.id,nome,valor_cents:valorCents,vencimento:formConta.vencimento,recorrente:formConta.recorrente,categoria:formConta.categoria,paga:false});
      cs.push({id:novoId,userId:usuario.id,nome,valorCents,vencimento:formConta.vencimento,recorrente:formConta.recorrente,categoria:formConta.categoria,paga:false,criadoEm:new Date().toISOString()});
    }
    DB.salvarContas(cs); carregarDados(usuario.id);
    const era=!!editarConta;
    setFormConta({nome:"",valorStr:"",vencimento:"",recorrente:false,categoria:"Outros"});
    setEditarConta(null);
    mostrarAviso(era?"Conta atualizada! ✓":"Conta cadastrada! ✓");
    setAba("contas");
  };

  const marcarContaPaga=async(id)=>{
    const cs=DB.contas();
    const idx=cs.findIndex(c=>c.id===id&&c.userId===usuario.id);
    if(idx<0) return;
    if(cs[idx].recorrente){
      const d=new Date(cs[idx].vencimento+"T00:00:00");
      d.setMonth(d.getMonth()+1);
      const novoVenc=d.toISOString().slice(0,10);
      if(supabase) await supabase.from("contas").update({vencimento:novoVenc}).eq("id",id).eq("user_id",usuario.id);
      cs[idx]={...cs[idx],vencimento:novoVenc};
      mostrarAviso("Pago! Próximo vencimento atualizado 📅");
    }else{
      const agora=new Date().toISOString();
      if(supabase) await supabase.from("contas").update({paga:true,paga_em:agora}).eq("id",id).eq("user_id",usuario.id);
      cs[idx]={...cs[idx],paga:true,pagaEm:agora};
      mostrarAviso("Conta marcada como paga! ✓");
    }
    DB.salvarContas(cs); carregarDados(usuario.id);
  };

  const excluirConta=async(id)=>{
    const c=DB.contas().find(x=>x.id===id);
    if(!c||c.userId!==usuario.id){mostrarAviso("Não autorizado",false);return;}
    if(supabase) await supabase.from("contas").delete().eq("id",id).eq("user_id",usuario.id);
    DB.salvarContas(DB.contas().filter(x=>x.id!==id)); carregarDados(usuario.id);
    mostrarAviso("Conta removida");
  };

  const dispensarNotif=(notifId)=>{
    setNotificacoes(prev=>prev.filter(n=>n.id!==notifId));
  };
  const enviarMsgIA=async()=>{
    const texto=san(msgIA);
    if(!texto||digIA) return;
    const novaMsgUser={role:"user",texto,id:Date.now()};
    const novoChat=[...chatIA,novaMsgUser];
    setChatIA(novoChat); setMsgIA(""); setDigIA(true);
    try{
      const {texto:resposta,fonte}=await chamarClaudeAPI(texto,novoChat,transacoes,perfil);
      setChatIA(prev=>[...prev,{role:"ia",texto:resposta,id:Date.now()+1,fonte}]);
      setFonteIA(fonte);
    }catch{
      const fb=respostaLocal(texto,transacoes,perfil);
      setChatIA(prev=>[...prev,{role:"ia",texto:fb,id:Date.now()+1,fonte:"local"}]);
      setFonteIA("local");
    }finally{ setDigIA(false); }
  };

  // ── CÁLCULOS CENTRALIZADOS (todos em centavos) ──────────────
  const getCents=(tx)=>tx.amountCents||toCents(tx.amount);
  const agora=new Date(), mesAtual=agora.getMonth(), anoAtual=agora.getFullYear();

  const receitasCents = somarCents(transacoes.filter(t=>t.tipo==="receita").map(getCents));
  const despesasCents = somarCents(transacoes.filter(t=>t.tipo==="despesa").map(getCents));
  const saldoCents    = receitasCents - despesasCents;

  const isMesAtual=(t)=>{
    try{const d=new Date(t.data+"T00:00:00");return d.getMonth()===mesAtual&&d.getFullYear()===anoAtual;}catch{return false;}
  };
  const gastoBarCents = somarCents(transacoes.filter(t=>t.tipo==="despesa"&&t.categoria==="Bar da escola"&&isMesAtual(t)).map(getCents));

  const txFiltradas=transacoes.filter(t=>{
    if(filtroCategoria!=="Todas"&&t.categoria!==filtroCategoria)return false;
    if(filtroData&&t.data!==filtroData)return false;
    if(filtroTipo!=="Todos"&&t.tipo!==filtroTipo)return false;
    return true;
  }).sort((a,b)=>(b.data||"").localeCompare(a.data||""));

  const dadosCat=CATEGORIAS.map(c=>({
    rotulo:c.split(" ")[0],
    valor:somarCents(transacoes.filter(t=>t.tipo==="despesa"&&t.categoria===c).map(getCents)),
    cor:CAT_CORES[c],nome:c
  })).filter(c=>c.valor>0);

  const dadosMensais=Array.from({length:6},(_,i)=>{
    const d=new Date(); d.setMonth(d.getMonth()-5+i);
    const m=d.getMonth(),y=d.getFullYear();
    return{rotulo:MESES[m],valor:somarCents(transacoes.filter(t=>{try{const dt=new Date(t.data+"T00:00:00");return t.tipo==="despesa"&&dt.getMonth()===m&&dt.getFullYear()===y;}catch{return false;}}).map(getCents))};
  });

  const txRecentes=[...transacoes].sort((a,b)=>(b.data||"").localeCompare(a.data||"")).slice(0,5);

  // ══════════════════════════════════════════════════════════════
  //  AUTH SCREEN
  // ══════════════════════════════════════════════════════════════
  if(!usuario){
    const eCad=telAuth==="cadastro";
    return(
      <div style={S.app}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
        <div style={{padding:"60px 28px 40px",display:"flex",flexDirection:"column",minHeight:"100vh"}}>
          <div style={{textAlign:"center",marginBottom:44}}>
            <div style={{width:72,height:72,borderRadius:22,background:"#00E676",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:32,boxShadow:"0 8px 32px #00E67644"}}>⚡</div>
            <h1 style={{fontSize:30,fontWeight:900,letterSpacing:-1.5,color:"#00E676",margin:0}}>AtlasTrack</h1>
            <p style={{color:"#444",fontSize:13,margin:"6px 0 0"}}>Carregue suas finanças com confiança</p>
          </div>
          <div style={{display:"flex",background:"#1a1a1a",borderRadius:16,padding:4,marginBottom:28}}>
            {[["login","Entrar"],["cadastro","Criar conta"]].map(([s,l])=>(
              <button key={s} onClick={()=>{setTelAuth(s);setErroAuth("");}}
                style={{flex:1,padding:"11px",border:"none",borderRadius:12,cursor:"pointer",fontWeight:700,fontSize:14,fontFamily:"inherit",transition:"all 0.2s",background:telAuth===s?"#00E676":"transparent",color:telAuth===s?"#000":"#555"}}>{l}</button>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {eCad&&<div><label style={S.rot}>Nome Completo</label><input style={S.inp} placeholder="Seu nome" value={formAuth.nome} onChange={e=>setFormAuth({...formAuth,nome:e.target.value})} onFocus={S.fi} onBlur={S.fo}/></div>}
            <div><label style={S.rot}>E-mail</label><input style={S.inp} type="email" placeholder="voce@email.com" value={formAuth.email} onChange={e=>setFormAuth({...formAuth,email:e.target.value})} onFocus={S.fi} onBlur={S.fo}/></div>
            <div><label style={S.rot}>Senha</label><input style={S.inp} type="password" placeholder="••••••" value={formAuth.senha} onChange={e=>setFormAuth({...formAuth,senha:e.target.value})} onFocus={S.fi} onBlur={S.fo}/></div>
            {erroAuth&&<p style={S.erro}>{erroAuth}</p>}
            <button style={{...S.btn,marginTop:8,opacity:carregando?0.7:1}} onClick={eCad?registrar:entrar} disabled={carregando}>
              {carregando?"Aguarde...":eCad?"Criar Conta":"Entrar"}
            </button>
          </div>
          <p style={{color:"#2a2a2a",fontSize:11,textAlign:"center",marginTop:"auto",paddingTop:28}}>🔒 Dados criptografados localmente</p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  QUESTIONÁRIO
  // ══════════════════════════════════════════════════════════════
  if(mostrarQ){
    const q=PERGUNTAS[etapaQ];
    return(
      <div style={S.app}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
        <div style={{padding:"50px 24px",display:"flex",flexDirection:"column",minHeight:"100vh"}}>
          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{fontSize:40,marginBottom:10}}>🧠</div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800,color:"#00E676"}}>Perfil Financeiro</h2>
            <p style={{color:"#555",fontSize:13,margin:"6px 0 0"}}>Identifique seu comportamento com dinheiro</p>
          </div>
          <div style={{background:"#1e1e1e",borderRadius:8,height:6,marginBottom:24,overflow:"hidden"}}>
            <div style={{width:`${(etapaQ/PERGUNTAS.length)*100}%`,height:"100%",background:"#00E676",borderRadius:8,transition:"width 0.4s ease"}}/>
          </div>
          <div style={{...S.card,flex:1}}>
            <p style={{fontSize:12,color:"#555",fontWeight:600,marginBottom:8}}>Pergunta {etapaQ+1} de {PERGUNTAS.length}</p>
            <p style={{fontSize:17,fontWeight:700,lineHeight:1.5,margin:"0 0 22px",color:"#fff"}}>{q.texto}</p>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {q.opcoes.map((op,i)=>(
                <button key={i} onClick={()=>responderQ(op.p)}
                  style={{background:"#121212",border:"1.5px solid #2a2a2a",borderRadius:14,padding:"14px 16px",color:"#ccc",fontSize:14,fontWeight:500,cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#00E676";e.currentTarget.style.color="#fff";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#2a2a2a";e.currentTarget.style.color="#ccc";}}>
                  {op.t}
                </button>
              ))}
            </div>
          </div>
          <button onClick={()=>setMostrarQ(false)} style={{...S.btnG,marginTop:14,fontSize:12}}>Pular por agora</button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  PAINEL
  // ══════════════════════════════════════════════════════════════
  const renderPainel=()=>(
    <div style={S.tela}>
      <div style={S.cab}>
        <div>
          <p style={{color:"#555",fontSize:13,margin:0}}>Olá,</p>
          <h2 style={{margin:"2px 0 0",fontSize:22,fontWeight:800}}>{primeiroNome(usuario.nome)} 👋</h2>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {/* Sino de notificações */}
          <div style={{position:"relative"}}>
            <button onClick={()=>setAbaNotif(true)}
              style={{background:"#1a1a1a",border:"1px solid #222",borderRadius:12,width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",position:"relative"}}>
              🔔
            </button>
            {notificacoes.length>0&&(
              <div style={S.notifBadge}>{notificacoes.length>9?"9+":notificacoes.length}</div>
            )}
          </div>
          <button onClick={sair} style={{background:"#1a1a1a",border:"1px solid #222",borderRadius:12,padding:"8px 14px",color:"#555",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Sair</button>
        </div>
      </div>
      <div style={{padding:"0 20px"}}>
        <div style={{...S.dest,background:saldoCents<0?"linear-gradient(135deg,#ff4455,#cc2233)":"linear-gradient(135deg,#00E676,#00C853)"}}>
          <p style={{margin:0,fontSize:11,fontWeight:700,opacity:0.6,letterSpacing:1,textTransform:"uppercase"}}>Saldo Total</p>
          <h1 style={{margin:"6px 0 4px",fontSize:34,fontWeight:900,letterSpacing:-2}}>{fmtSaldo(saldoCents)}</h1>
          <p style={{margin:0,fontSize:12,opacity:0.6}}>{agora.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</p>
          <div style={{display:"flex",gap:12,marginTop:18}}>
            {[["RECEITAS",receitasCents],["DESPESAS",despesasCents]].map(([l,v])=>(
              <div key={l} style={{flex:1,background:"rgba(0,0,0,0.18)",borderRadius:12,padding:"10px 14px"}}>
                <p style={{margin:0,fontSize:9,fontWeight:700,opacity:0.7,letterSpacing:1}}>{l}</p>
                <p style={{margin:"4px 0 0",fontSize:16,fontWeight:800}}>{fmtC(v)}</p>
              </div>
            ))}
          </div>
        </div>

        {perfil&&(
          <div style={{...S.card,border:`1.5px solid ${perfil.cor}33`,marginBottom:16}}>
            <div style={S.row}>
              <div>
                <p style={{margin:0,fontSize:11,color:"#555",fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>Perfil Financeiro</p>
                <p style={{margin:"4px 0 0",fontSize:18,fontWeight:800,color:perfil.cor}}>{perfil.emoji} {perfil.tipo}</p>
              </div>
              <button onClick={()=>setMostrarQ(true)} style={{background:"transparent",border:`1px solid ${perfil.cor}55`,borderRadius:10,padding:"6px 12px",color:perfil.cor,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>Refazer</button>
            </div>
            <p style={{margin:"8px 0 0",fontSize:12,color:"#888",lineHeight:1.5}}>{perfil.desc}</p>
          </div>
        )}

        {gastoBarCents>0&&(
          <div style={{...S.card,border:"1.5px solid #FF8C4233",background:"#FF8C4208",marginBottom:16}}>
            <div style={S.row}>
              <div>
                <p style={{margin:0,fontSize:11,color:"#FF8C42",fontWeight:700,letterSpacing:0.5}}>🧃 BAR DA ESCOLA — ESTE MÊS</p>
                <p style={{margin:"4px 0 0",fontSize:20,fontWeight:800,color:"#fff"}}>{fmt(gastoBarCents)}</p>
              </div>
              {gastoBarCents>8000&&<span style={{background:"#FF8C4222",color:"#FF8C42",borderRadius:8,padding:"4px 10px",fontSize:11,fontWeight:700}}>⚠️ Alto</span>}
            </div>
            {gastoBarCents>8000&&<p style={{margin:"8px 0 0",fontSize:12,color:"#888"}}>Você está gastando muito no bar. Tente manter abaixo de R$80,00!</p>}
          </div>
        )}

        <div style={S.card}>
          <div style={{...S.row,marginBottom:14}}>
            <span style={{fontWeight:700,fontSize:15}}>Gastos Mensais</span>
            <span style={{fontSize:12,color:"#555"}}>Últimos 6 meses</span>
          </div>
          <GraficoBarras data={dadosMensais} altura={90}/>
        </div>

        <div style={S.card}>
          <div style={{...S.row,marginBottom:12}}>
            <span style={{fontWeight:700,fontSize:15}}>Transações Recentes</span>
            <button onClick={()=>setAba("historico")} style={{background:"none",border:"none",color:"#00E676",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Ver tudo</button>
          </div>
          {txRecentes.length===0&&<p style={{color:"#444",textAlign:"center",padding:"18px 0",margin:0}}>Nenhuma transação ainda</p>}
          {txRecentes.map((t,i)=>(
            <div key={t.id}>
              {i>0&&<div style={S.sep}/>}
              <div style={{...S.row,padding:"8px 0"}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:40,height:40,borderRadius:12,background:t.tipo==="receita"?"#00E67618":"#ff444518",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{CAT_ICONES[t.categoria]||"💰"}</div>
                  <div>
                    <p style={{margin:0,fontSize:14,fontWeight:600}}>{t.descricao||t.categoria||"—"}</p>
                    <p style={{margin:0,fontSize:11,color:"#555"}}>{t.data} · {t.categoria}</p>
                  </div>
                </div>
                <span style={{fontWeight:800,color:t.tipo==="receita"?"#00E676":"#ff6666",fontSize:15,flexShrink:0}}>
                  {t.tipo==="receita"?"+":"-"}{fmt(getCents(t))}
                </span>
              </div>
            </div>
          ))}
        </div>
        <button onClick={()=>setAba("adicionar")} style={{...S.btn,marginTop:4}}>+ Adicionar Transação</button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  //  ADICIONAR TRANSAÇÃO
  // ══════════════════════════════════════════════════════════════
  const renderAdicionar=()=>{
    const isBar=formTx.categoria==="Bar da escola";
    const isOutros=formTx.categoria==="Outros";
    return(
      <div style={S.tela}>
        <div style={S.cab}><h2 style={{margin:0,fontSize:22,fontWeight:800}}>Nova Transação</h2></div>
        <div style={{padding:"0 20px",display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"flex",background:"#1a1a1a",borderRadius:16,padding:4}}>
            {[["despesa","💸 Despesa"],["receita","💰 Receita"]].map(([tipo,label])=>(
              <button key={tipo} onClick={()=>setFormTx({...formTx,tipo})}
                style={{flex:1,padding:"11px",border:"none",borderRadius:12,cursor:"pointer",fontWeight:700,fontSize:14,fontFamily:"inherit",transition:"all 0.2s",background:formTx.tipo===tipo?(tipo==="receita"?"#00E676":"#ff4455"):"transparent",color:formTx.tipo===tipo?"#000":"#555"}}>{label}</button>
            ))}
          </div>

          <div>
            <label style={S.rot}>Valor (R$)</label>
            <input style={{...S.inp,fontSize:26,fontWeight:900,textAlign:"center"}} type="number" min="0" step="0.01" placeholder="0,00"
              value={inputValor} onChange={e=>setInputValor(e.target.value)} onFocus={S.fi} onBlur={S.fo}/>
            {inputValor&&toCents(inputValor)>0&&(
              <p style={{textAlign:"center",color:"#00E676",fontSize:12,margin:"6px 0 0",fontWeight:700}}>
                = {fmt(toCents(inputValor))}
              </p>
            )}
          </div>

          {formTx.tipo==="despesa"&&(
          <div>
            <label style={S.rot}>Categoria</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {CATEGORIAS.map(c=>(
                <button key={c} onClick={()=>setFormTx({...formTx,categoria:c,subcat:""})}
                  style={{...S.chip(formTx.categoria===c),display:"flex",alignItems:"center",gap:5}}>
                  {CAT_ICONES[c]} {c}
                </button>
              ))}
            </div>
          </div>
          )}

          {isBar&&(
            <div style={{...S.card,padding:16,background:"#FF8C4210",border:"1.5px solid #FF8C4230"}}>
              <p style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:"#FF8C42"}}>🧃 Bar da Escola</p>
              <p style={{margin:"0 0 8px",fontSize:12,color:"#888"}}>Subcategoria (opcional):</p>
              <div style={{display:"flex",gap:8}}>
                {BAR_SUBCATS.map(s=>(
                  <button key={s} onClick={()=>setFormTx({...formTx,subcat:s})} style={{...S.chip(formTx.subcat===s),flex:1,textAlign:"center"}}>{s}</button>
                ))}
              </div>
              <p style={{margin:"12px 0 0",fontSize:11,color:"#666"}}>Digite o valor desejado no campo acima ↑</p>
            </div>
          )}

          <div>
            <label style={S.rot}>Descrição {isOutros&&<span style={{color:"#ff6666"}}>*obrigatório</span>}</label>
            <input style={S.inp} placeholder={formTx.tipo==="receita"?"Ex: Mesada, salário, presente...":isOutros?"Descreva este gasto...":"Para que foi esse gasto? (opcional)"} value={formTx.descricao}
              onChange={e=>setFormTx({...formTx,descricao:e.target.value})} onFocus={S.fi} onBlur={S.fo}/>
          </div>
          <div>
            <label style={S.rot}>Data</label>
            <input style={S.inp} type="date" value={formTx.data} onChange={e=>setFormTx({...formTx,data:e.target.value})} onFocus={S.fi} onBlur={S.fo}/>
          </div>
          <button style={{...S.btn,background:formTx.tipo==="receita"?"#00E676":"#ff4455",marginTop:4}} onClick={()=>adicionarTransacao()}>
            Salvar Transação
          </button>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════
  //  HISTÓRICO
  // ══════════════════════════════════════════════════════════════
  const renderHistorico=()=>(
    <div style={S.tela}>
      <div style={S.cab}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Histórico</h2>
        <span style={{color:"#555",fontSize:13}}>{txFiltradas.length} registros</span>
      </div>
      <div style={{padding:"0 20px"}}>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {["Todos","receita","despesa"].map(t=>(
            <button key={t} onClick={()=>setFiltroTipo(t)} style={S.chip(filtroTipo===t)}>
              {t==="Todos"?"Todos":t==="receita"?"💰 Receitas":"💸 Despesas"}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:12}}>
          {["Todas",...CATEGORIAS].map(c=>(
            <button key={c} onClick={()=>setFiltroCategoria(c)} style={S.chip(filtroCategoria===c)}>{c}</button>
          ))}
        </div>
        <div style={{marginBottom:12}}>
          <input style={S.inp} type="date" value={filtroData} onChange={e=>setFiltroData(e.target.value)} onFocus={S.fi} onBlur={S.fo}/>
        </div>
        {filtroData&&<button onClick={()=>setFiltroData("")} style={{...S.btnG,marginBottom:12,fontSize:12}}>Limpar data ✕</button>}
        <div style={S.card}>
          {txFiltradas.length===0&&<p style={{color:"#444",textAlign:"center",padding:"20px 0",margin:0}}>Nenhuma transação encontrada</p>}
          {txFiltradas.map((t,i)=>(
            <div key={t.id}>
              {i>0&&<div style={S.sep}/>}
              <div style={{...S.row,padding:"10px 0"}}>
                <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
                  <div style={{width:42,height:42,borderRadius:12,background:t.tipo==="receita"?"#00E67618":"#ff444518",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{CAT_ICONES[t.categoria]||"💰"}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:0,fontSize:14,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.descricao||t.categoria||"—"}</p>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginTop:3}}>
                      <span style={S.badge(t.tipo)}>{t.tipo}</span>
                      <span style={{fontSize:11,color:"#555"}}>{t.data}</span>
                    </div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  <span style={{fontWeight:800,color:t.tipo==="receita"?"#00E676":"#ff6666",fontSize:14}}>
                    {t.tipo==="receita"?"+":"-"}{fmt(getCents(t))}
                  </span>
                  <button onClick={()=>excluirTx(t.id)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:16,padding:"2px 6px",fontFamily:"inherit"}}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  //  ESTATÍSTICAS
  // ══════════════════════════════════════════════════════════════
  const renderEstatisticas=()=>(
    <div style={S.tela}>
      <div style={S.cab}><h2 style={{margin:0,fontSize:22,fontWeight:800}}>Estatísticas</h2></div>
      <div style={{padding:"0 20px"}}>
        <div style={S.card}>
          <p style={{margin:"0 0 14px",fontWeight:700,fontSize:15}}>Receitas vs Despesas</p>
          {[{label:"Receitas",v:receitasCents,cor:"#00E676"},{label:"Despesas",v:despesasCents,cor:"#ff4455"}].map(item=>(
            <div key={item.label} style={{marginBottom:12}}>
              <div style={{...S.row,marginBottom:5}}>
                <span style={{fontSize:13,color:"#aaa"}}>{item.label}</span>
                <span style={{fontSize:14,fontWeight:800,color:item.cor}}>{fmt(item.v)}</span>
              </div>
              <div style={{background:"#1e1e1e",borderRadius:6,height:8,overflow:"hidden"}}>
                <div style={{width:`${receitasCents>0?(item.v/Math.max(receitasCents,despesasCents))*100:0}%`,height:"100%",background:item.cor,borderRadius:6,transition:"width 0.8s ease"}}/>
              </div>
            </div>
          ))}
          <div style={{...S.sep,margin:"14px 0"}}/>
          <div style={S.row}>
            <span style={{color:"#555",fontSize:13}}>Taxa de Poupança</span>
            <span style={{color:saldoCents>=0?"#00E676":"#ff6666",fontWeight:800,fontSize:15}}>
              {receitasCents>0?Math.round((saldoCents/receitasCents)*100):0}%
            </span>
          </div>
        </div>

        <div style={{...S.card,border:"1.5px solid #FF8C4222"}}>
          <p style={{margin:"0 0 12px",fontWeight:700,fontSize:15}}>🧃 Bar da Escola — Mês Atual</p>
          {gastoBarCents===0
            ?<p style={{color:"#444",margin:0,fontSize:13}}>Sem gastos no bar este mês.</p>
            :<>
              <div style={{...S.row,marginBottom:8}}>
                <span style={{fontSize:13,color:"#aaa"}}>Total</span>
                <span style={{fontWeight:800,color:"#FF8C42",fontSize:16}}>{fmt(gastoBarCents)}</span>
              </div>
              {BAR_SUBCATS.map(sub=>{
                const v=somarCents(transacoes.filter(t=>t.tipo==="despesa"&&t.categoria==="Bar da escola"&&t.subcat===sub&&isMesAtual(t)).map(getCents));
                return v>0?(<div key={sub} style={{...S.row,marginBottom:6}}><span style={{fontSize:13,color:"#888"}}>{sub}</span><span style={{fontSize:13,fontWeight:700}}>{fmt(v)}</span></div>):null;
              })}
              {gastoBarCents>8000&&<div style={{background:"#FF8C4215",borderRadius:10,padding:"10px 12px",marginTop:10}}><p style={{margin:0,fontSize:12,color:"#FF8C42"}}>⚠️ Tente manter abaixo de R$80,00 por mês!</p></div>}
            </>
          }
        </div>

        <div style={S.card}>
          <p style={{margin:"0 0 14px",fontWeight:700,fontSize:15}}>Gastos por Categoria</p>
          {dadosCat.length===0
            ?<p style={{color:"#444",textAlign:"center",padding:"14px 0",margin:0}}>Nenhuma despesa ainda</p>
            :<>
              <GraficoRosca segmentos={dadosCat} tamanho={150}/>
              <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>
                {dadosCat.map(c=>(
                  <div key={c.nome} style={S.row}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:10,height:10,borderRadius:3,background:c.cor,flexShrink:0}}/>
                      <span style={{fontSize:13,color:"#aaa"}}>{c.nome}</span>
                    </div>
                    <span style={{fontSize:14,fontWeight:700}}>{fmt(c.valor)}</span>
                  </div>
                ))}
              </div>
            </>
          }
        </div>
        <div style={S.card}>
          <p style={{margin:"0 0 14px",fontWeight:700,fontSize:15}}>Gastos Mensais</p>
          <GraficoBarras data={dadosMensais} altura={100}/>
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  //  METAS
  // ══════════════════════════════════════════════════════════════
  const renderMetas=()=>{
    if(aba==="nova-meta") return(
      <div style={S.tela}>
        <div style={S.cab}>
          <h2 style={{margin:0,fontSize:22,fontWeight:800}}>{editarMeta?"Editar Meta":"Nova Meta"}</h2>
          <button onClick={()=>{setAba("metas");setEditarMeta(null);setFormMeta({nomeMeta:"",prazo:""});setInputAlvo("");setInputGuardado("");}}
            style={{background:"none",border:"none",color:"#555",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
        </div>
        <div style={{padding:"0 20px",display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <label style={S.rot}>Nome da Meta</label>
            <input style={S.inp} placeholder="Ex: Notebook, Viagem, Curso..." value={formMeta.nomeMeta}
              onChange={e=>setFormMeta({...formMeta,nomeMeta:e.target.value})} onFocus={S.fi} onBlur={S.fo}/>
          </div>
          <div>
            <label style={S.rot}>Valor Alvo (R$)</label>
            <input style={S.inp} type="number" min="0" step="0.01" placeholder="0,00" value={inputAlvo}
              onChange={e=>setInputAlvo(e.target.value)} onFocus={S.fi} onBlur={S.fo}/>
            {inputAlvo&&toCents(inputAlvo)>0&&<p style={{color:"#00E676",fontSize:12,margin:"4px 0 0",fontWeight:700}}>= {fmt(toCents(inputAlvo))}</p>}
          </div>
          <div>
            <label style={S.rot}>Valor Já Guardado (R$)</label>
            <input style={S.inp} type="number" min="0" step="0.01" placeholder="0,00" value={inputGuardado}
              onChange={e=>setInputGuardado(e.target.value)} onFocus={S.fi} onBlur={S.fo}/>
          </div>
          <div>
            <label style={S.rot}>Prazo</label>
            <input style={S.inp} type="date" value={formMeta.prazo}
              onChange={e=>setFormMeta({...formMeta,prazo:e.target.value})} onFocus={S.fi} onBlur={S.fo}/>
          </div>
          <button style={S.btn} onClick={salvarMeta}>{editarMeta?"Atualizar Meta":"Criar Meta"}</button>
        </div>
      </div>
    );
    return(
      <div style={S.tela}>
        <div style={S.cab}>
          <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Metas de Poupança</h2>
          <button onClick={()=>setAba("nova-meta")} style={S.btnSm}>+ Nova</button>
        </div>
        <div style={{padding:"0 20px"}}>
          {metas.length===0&&(
            <div style={{...S.card,textAlign:"center",padding:"40px 20px"}}>
              <div style={{fontSize:48,marginBottom:12}}>🎯</div>
              <p style={{color:"#555",margin:"0 0 16px",fontSize:14}}>Defina sua primeira meta e acompanhe o progresso!</p>
              <button onClick={()=>setAba("nova-meta")} style={S.btn}>Criar uma Meta</button>
            </div>
          )}
          {metas.map(m=>{
            const alvoCents=m.valorAlvoCents||toCents(m.valorAlvo);
            const guardadoCents=m.valorGuardadoCents||toCents(m.valorGuardado);
            const pct=alvoCents>0?guardadoCents/alvoCents:0;
            const dias=m.prazo?Math.ceil((new Date(m.prazo+"T00:00:00")-new Date())/86400000):null;
            return(
              <div key={m.id} style={S.card}>
                <div style={S.row}>
                  <div style={{flex:1}}>
                    <p style={{margin:0,fontWeight:800,fontSize:17}}>{m.nomeMeta}</p>
                    {m.prazo&&<p style={{margin:"4px 0 0",fontSize:12,color:dias!==null&&dias<=30?"#FF8C42":"#555"}}>{dias!==null&&dias>0?`${dias} dias restantes`:"Prazo encerrado"}</p>}
                  </div>
                  <Anel pct={pct} tam={64}/>
                </div>
                <div style={{margin:"12px 0 8px"}}>
                  <div style={{background:"#0e0e0e",borderRadius:8,height:10,overflow:"hidden"}}>
                    <div style={{width:`${Math.min(pct*100,100)}%`,height:"100%",background:"linear-gradient(90deg,#00E676,#69F0AE)",borderRadius:8,transition:"width 0.8s ease"}}/>
                  </div>
                </div>
                <div style={S.row}>
                  <span style={{color:"#00E676",fontWeight:700,fontSize:14}}>{fmt(guardadoCents)} guardado</span>
                  <span style={{color:"#555",fontSize:13}}>de {fmt(alvoCents)}</span>
                </div>
                <div style={{display:"flex",gap:8,marginTop:14}}>
                  <button onClick={()=>{setEditarMeta(m);setFormMeta({nomeMeta:m.nomeMeta,prazo:m.prazo||""});setInputAlvo(fmtInput(alvoCents));setInputGuardado(fmtInput(guardadoCents));setAba("nova-meta");}}
                    style={{...S.btnG,flex:1,fontSize:13}}>Editar</button>
                  <button onClick={()=>excluirMeta(m.id)}
                    style={{background:"#ff445515",border:"1.5px solid #ff444530",borderRadius:10,padding:"8px 16px",color:"#ff6666",fontSize:13,fontWeight:600,cursor:"pointer",flex:1,fontFamily:"inherit"}}>Excluir</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════
  //  ATLAS IA
  // ══════════════════════════════════════════════════════════════
  const renderAtlasIA=()=>(
    <div style={{...S.tela,display:"flex",flexDirection:"column",height:"100vh",paddingBottom:0}}>
      <div style={S.cab}>
        <div>
          <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Atlas IA</h2>
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:fonteIA==="claude"?"#00E676":"#FFB347",flexShrink:0}}/>
            <p style={{margin:0,fontSize:11,color:"#555"}}>
              {fonteIA==="claude"?"Conectado ao Claude AI":"Modo offline — respostas locais"}
            </p>
          </div>
        </div>
        <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#00E676,#00C853)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🤖</div>
      </div>

      {perfil&&(
        <div style={{margin:"0 20px 12px",background:`${perfil.cor}15`,border:`1px solid ${perfil.cor}33`,borderRadius:14,padding:"10px 14px"}}>
          <p style={{margin:0,fontSize:12,color:perfil.cor,fontWeight:700}}>{perfil.emoji} Perfil: {perfil.tipo}</p>
          <p style={{margin:"3px 0 0",fontSize:11,color:"#666"}}>{perfil.desc}</p>
        </div>
      )}

      <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"0 20px 12px",display:"flex",flexDirection:"column",gap:12}}>
        {chatIA.length===0&&(
          <div style={{textAlign:"center",padding:"24px 0"}}>
            <div style={{fontSize:44,marginBottom:10}}>💬</div>
            <p style={{color:"#555",fontSize:14,margin:"0 0 18px"}}>Pergunte qualquer coisa sobre suas finanças</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"}}>
              {["Qual meu saldo?","Gastos do bar","Dica de economia","Meu perfil","Resumo do mês","Maior gasto"].map(s=>(
                <button key={s} onClick={()=>{setMsgIA(s);setTimeout(()=>{
                  const txt=document.createElement("input");
                  txt.value=s;
                  const ev=new Event("click");
                  // Trigger send directly
                  const novaMsgUser={role:"user",texto:s,id:Date.now()};
                  setChatIA(prev=>[...prev,novaMsgUser]);
                  setDigIA(true);
                  chamarClaudeAPI(s,[novaMsgUser],transacoes,perfil).then(({texto,fonte})=>{
                    setChatIA(prev=>[...prev,{role:"ia",texto,id:Date.now()+1,fonte}]);
                    setFonteIA(fonte); setDigIA(false);
                  }).catch(()=>{
                    const fb=respostaLocal(s,transacoes,perfil);
                    setChatIA(prev=>[...prev,{role:"ia",texto:fb,id:Date.now()+1,fonte:"local"}]);
                    setFonteIA("local"); setDigIA(false);
                  });
                },0);}} style={{...S.chip(false),fontSize:12}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatIA.map(m=>(
          <div key={m.id} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            {m.role==="ia"&&<div style={{width:30,height:30,borderRadius:10,background:"#00E67622",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,marginRight:8,alignSelf:"flex-end"}}>🤖</div>}
            <div style={{maxWidth:"82%"}}>
              <div style={{background:m.role==="user"?"#00E676":"#1e1e1e",borderRadius:m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"12px 16px",color:m.role==="user"?"#000":"#e0e0e0"}}>
                {m.role==="ia"?<TextoIA texto={m.texto}/>:<span style={{fontSize:14}}>{m.texto}</span>}
              </div>
              {m.role==="ia"&&m.fonte&&(
                <p style={{margin:"4px 0 0 4px",fontSize:10,color:"#333"}}>
                  {m.fonte==="claude"?"🟢 Claude AI":"🟡 offline"}
                </p>
              )}
            </div>
          </div>
        ))}

        {digIA&&(
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:30,height:30,borderRadius:10,background:"#00E67622",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🤖</div>
            <div style={{background:"#1e1e1e",borderRadius:"18px 18px 18px 4px",padding:"12px 16px"}}>
              <span style={{color:"#555",fontSize:14}}>Analisando seus dados...</span>
            </div>
          </div>
        )}
      </div>

      <div style={{padding:"12px 20px 96px",borderTop:"1px solid #1e1e1e",background:"#121212"}}>
        <div style={{display:"flex",gap:8}}>
          <input style={{...S.inp,flex:1,padding:"13px 16px"}} placeholder="Pergunte sobre seus gastos..."
            value={msgIA} onChange={e=>setMsgIA(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!digIA){e.preventDefault();enviarMsgIA();}}}
            onFocus={S.fi} onBlur={S.fo}/>
          <button onClick={enviarMsgIA} disabled={digIA}
            style={{background:digIA?"#1a1a1a":"#00E676",border:"none",borderRadius:14,padding:"0 18px",color:digIA?"#444":"#000",fontSize:20,cursor:digIA?"not-allowed":"pointer",fontFamily:"inherit",flexShrink:0,transition:"all 0.2s"}}>
            ➤
          </button>
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  //  CONTAS A PAGAR
  // ══════════════════════════════════════════════════════════════
  const renderContas=()=>{
    const isForm=aba==="nova-conta";
    const contasPend=contas.filter(c=>!c.paga).sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
    const contasPagas=contas.filter(c=>c.paga).sort((a,b)=>(b.pagaEm||"").localeCompare(a.pagaEm||""));

    if(isForm) return(
      <div style={S.tela}>
        <div style={S.cab}>
          <h2 style={{margin:0,fontSize:22,fontWeight:800}}>{editarConta?"Editar Conta":"Nova Conta"}</h2>
          <button onClick={()=>{setAba("contas");setEditarConta(null);setFormConta({nome:"",valorStr:"",vencimento:"",recorrente:false,categoria:"Outros"});}}
            style={{background:"none",border:"none",color:"#555",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
        </div>
        <div style={{padding:"0 20px",display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <label style={S.rot}>Nome da Conta</label>
            <input style={S.inp} placeholder="Ex: Internet, Aluguel, Mensalidade..." value={formConta.nome}
              onChange={e=>setFormConta({...formConta,nome:e.target.value})} onFocus={S.fi} onBlur={S.fo}/>
          </div>
          <div>
            <label style={S.rot}>Valor (R$)</label>
            <input style={S.inp} type="number" min="0" step="0.01" placeholder="0,00" value={formConta.valorStr}
              onChange={e=>setFormConta({...formConta,valorStr:e.target.value})} onFocus={S.fi} onBlur={S.fo}/>
            {formConta.valorStr&&toCents(formConta.valorStr)>0&&(
              <p style={{color:"#00E676",fontSize:12,margin:"4px 0 0",fontWeight:700}}>= {fmt(toCents(formConta.valorStr))}</p>
            )}
          </div>
          <div>
            <label style={S.rot}>Vencimento</label>
            <input style={S.inp} type="date" value={formConta.vencimento}
              onChange={e=>setFormConta({...formConta,vencimento:e.target.value})} onFocus={S.fi} onBlur={S.fo}/>
          </div>
          <div>
            <label style={S.rot}>Categoria</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {["Moradia","Educação","Saúde","Transporte","Assinaturas","Outros"].map(c=>(
                <button key={c} onClick={()=>setFormConta({...formConta,categoria:c})} style={S.chip(formConta.categoria===c)}>{c}</button>
              ))}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,background:"#1a1a1a",borderRadius:14,padding:"14px 16px"}}>
            <div onClick={()=>setFormConta({...formConta,recorrente:!formConta.recorrente})}
              style={{width:44,height:24,borderRadius:12,background:formConta.recorrente?"#00E676":"#2a2a2a",position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}}>
              <div style={{position:"absolute",top:2,left:formConta.recorrente?22:2,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
            </div>
            <div>
              <p style={{margin:0,fontSize:14,fontWeight:600,color:formConta.recorrente?"#00E676":"#fff"}}>Conta recorrente (mensal)</p>
              <p style={{margin:"2px 0 0",fontSize:11,color:"#555"}}>Ao marcar como paga, avança automaticamente pro próximo mês</p>
            </div>
          </div>
          <button style={S.btn} onClick={salvarConta}>{editarConta?"Atualizar Conta":"Cadastrar Conta"}</button>
        </div>
      </div>
    );

    // Lista de contas
    return(
      <div style={S.tela}>
        <div style={S.cab}>
          <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Contas a Pagar</h2>
          <button onClick={()=>setAba("nova-conta")} style={S.btnSm}>+ Nova</button>
        </div>
        <div style={{padding:"0 20px"}}>
          {/* Resumo */}
          {contasPend.length>0&&(()=>{
            const totalPend=somarCents(contasPend.map(c=>c.valorCents));
            const urgentes=contasPend.filter(c=>{
              const d=Math.ceil((new Date(c.vencimento+"T00:00:00")-new Date())/86400000);
              return d<=3;
            });
            return(
              <div style={{...S.card,border:`1.5px solid ${urgentes.length>0?"#ff445533":"#2a2a2a"}`,marginBottom:16}}>
                <div style={S.row}>
                  <div>
                    <p style={{margin:0,fontSize:11,color:"#555",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>Total pendente</p>
                    <p style={{margin:"4px 0 0",fontSize:22,fontWeight:900,color:urgentes.length>0?"#ff6666":"#fff"}}>{fmt(totalPend)}</p>
                  </div>
                  {urgentes.length>0&&(
                    <div style={{background:"#ff445520",borderRadius:12,padding:"8px 12px",textAlign:"center"}}>
                      <p style={{margin:0,fontSize:18,fontWeight:900,color:"#ff6666"}}>{urgentes.length}</p>
                      <p style={{margin:0,fontSize:10,color:"#ff6666",fontWeight:700}}>urgente{urgentes.length>1?"s":""}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Contas pendentes */}
          {contasPend.length===0&&contasPagas.length===0&&(
            <div style={{...S.card,textAlign:"center",padding:"40px 20px"}}>
              <div style={{fontSize:48,marginBottom:12}}>🧾</div>
              <p style={{color:"#555",margin:"0 0 16px",fontSize:14}}>Cadastre suas contas e receba alertas antes do vencimento!</p>
              <button onClick={()=>setAba("nova-conta")} style={S.btn}>Cadastrar Conta</button>
            </div>
          )}

          {contasPend.length>0&&(
            <>
              <p style={{...S.rot,marginBottom:10}}>Pendentes ({contasPend.length})</p>
              {contasPend.map(c=>{
                const venc=new Date(c.vencimento+"T00:00:00");
                const dias=Math.ceil((venc-new Date())/86400000);
                const urgente=dias<=3;
                const vencida=dias<0;
                const corBorda=vencida?"#ff4455":urgente?"#FFB347":"#2a2a2a";
                const corDias=vencida?"#ff6666":urgente?"#FFB347":"#555";
                return(
                  <div key={c.id} style={{...S.card,border:`1.5px solid ${corBorda}`,marginBottom:12}}>
                    <div style={S.row}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{fontSize:15}}>{vencida?"🚨":urgente?"⚠️":"📅"}</span>
                          <p style={{margin:0,fontWeight:800,fontSize:16}}>{c.nome}</p>
                          {c.recorrente&&<span style={{background:"#00E67622",color:"#00E676",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>MENSAL</span>}
                        </div>
                        <p style={{margin:0,fontSize:20,fontWeight:900,color:"#fff"}}>{fmt(c.valorCents)}</p>
                        <p style={{margin:"4px 0 0",fontSize:12,color:corDias,fontWeight:600}}>
                          {vencida?`Vencida há ${Math.abs(dias)} dia${Math.abs(dias)>1?"s":""}`:dias===0?"Vence HOJE!":dias===1?"Vence amanhã":`Vence em ${dias} dias`} — {c.vencimento}
                        </p>
                        <p style={{margin:"2px 0 0",fontSize:11,color:"#444"}}>{c.categoria}</p>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:12}}>
                      <button onClick={()=>marcarContaPaga(c.id)}
                        style={{flex:2,background:"#00E676",border:"none",borderRadius:10,padding:"10px",color:"#000",fontWeight:800,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                        ✓ Marcar como Paga
                      </button>
                      <button onClick={()=>{setEditarConta(c);setFormConta({nome:c.nome,valorStr:fmtInput(c.valorCents),vencimento:c.vencimento,recorrente:c.recorrente,categoria:c.categoria});setAba("nova-conta");}}
                        style={{...S.btnG,flex:1,fontSize:12}}>Editar</button>
                      <button onClick={()=>excluirConta(c.id)}
                        style={{background:"#ff445515",border:"1.5px solid #ff444530",borderRadius:10,padding:"8px",color:"#ff6666",fontSize:16,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Contas pagas */}
          {contasPagas.length>0&&(
            <>
              <p style={{...S.rot,marginTop:8,marginBottom:10}}>Pagas recentemente ({contasPagas.length})</p>
              {contasPagas.slice(0,3).map(c=>(
                <div key={c.id} style={{...S.card,opacity:0.55,marginBottom:8}}>
                  <div style={S.row}>
                    <div>
                      <p style={{margin:0,fontWeight:700,fontSize:14,textDecoration:"line-through",color:"#666"}}>{c.nome}</p>
                      <p style={{margin:"2px 0 0",fontSize:12,color:"#444"}}>{fmt(c.valorCents)} · {c.vencimento}</p>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:"#00E676",fontWeight:700,fontSize:12}}>✓ Pago</span>
                      <button onClick={()=>excluirConta(c.id)} style={{background:"none",border:"none",color:"#333",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════
  //  DRAWER DE NOTIFICAÇÕES
  // ══════════════════════════════════════════════════════════════
  const renderNotificacoes=()=>(
    <>
      {/* Overlay */}
      <div onClick={()=>setAbaNotif(false)}
        style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:200,backdropFilter:"blur(2px)"}}/>
      {/* Drawer */}
      <div style={{position:"fixed",top:0,right:0,width:"100%",maxWidth:430,height:"100vh",background:"#0e0e0e",zIndex:201,display:"flex",flexDirection:"column",overflowY:"auto"}}>
        <div style={{padding:"52px 20px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #1e1e1e"}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800}}>Notificações</h2>
            <p style={{margin:"2px 0 0",fontSize:12,color:"#555"}}>{notificacoes.length} alerta{notificacoes.length!==1?"s":""}</p>
          </div>
          <button onClick={()=>setAbaNotif(false)}
            style={{background:"#1a1a1a",border:"none",borderRadius:12,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",color:"#fff"}}>✕</button>
        </div>

        <div style={{flex:1,padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
          {notificacoes.length===0&&(
            <div style={{textAlign:"center",padding:"60px 0"}}>
              <div style={{fontSize:52,marginBottom:12}}>✅</div>
              <p style={{color:"#555",fontSize:15,fontWeight:600}}>Tudo em ordem!</p>
              <p style={{color:"#333",fontSize:13,marginTop:6}}>Nenhuma notificação no momento.</p>
            </div>
          )}
          {notificacoes.map(n=>(
            <div key={n.id} style={{background:BG_NOTIF[n.tipo]||"#1a1a1a",border:`1px solid ${COR_NOTIF[n.tipo]}33`,borderLeft:`3px solid ${COR_NOTIF[n.tipo]}`,borderRadius:14,padding:"14px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{display:"flex",gap:10,flex:1}}>
                  <span style={{fontSize:20,flexShrink:0}}>{n.icone}</span>
                  <div>
                    <p style={{margin:0,fontWeight:700,fontSize:14,color:COR_NOTIF[n.tipo]}}>{n.titulo}</p>
                    <p style={{margin:"4px 0 0",fontSize:12,color:"#aaa",lineHeight:1.5}}>{n.desc}</p>
                  </div>
                </div>
                <button onClick={()=>dispensarNotif(n.id)}
                  style={{background:"none",border:"none",color:"#333",cursor:"pointer",fontSize:16,flexShrink:0,padding:"0 0 0 4px"}}>✕</button>
              </div>
              {/* Ação rápida para contas */}
              {n.contaId&&(
                <button onClick={()=>{marcarContaPaga(n.contaId);dispensarNotif(n.id);}}
                  style={{marginTop:10,background:COR_NOTIF[n.tipo],border:"none",borderRadius:8,padding:"8px 14px",color:"#000",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  ✓ Marcar como Paga
                </button>
              )}
            </div>
          ))}

          {/* Atalho para cadastrar contas */}
          <div style={{...S.card,border:"1px dashed #2a2a2a",textAlign:"center",marginTop:8}}>
            <p style={{color:"#555",fontSize:13,margin:"0 0 10px"}}>Cadastre contas para receber alertas de vencimento</p>
            <button onClick={()=>{setAbaNotif(false);setAba("contas");}}
              style={{...S.btnSm,width:"100%"}}>+ Cadastrar Conta a Pagar</button>
          </div>
        </div>
      </div>
    </>
  );

  // ══════════════════════════════════════════════════════════════
  //  POPUP DE URGÊNCIA (ao abrir o app)
  // ══════════════════════════════════════════════════════════════
  const renderPopupUrgente=()=>{
    const urgentes=notificacoes.filter(n=>n.tipo==="perigo");
    if(!urgentes.length) return null;
    return(
      <>
        <div onClick={()=>setPopupInicial(false)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:300,backdropFilter:"blur(4px)"}}/>
        <div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:"#1a1a1a",borderRadius:24,padding:"28px 24px",width:"calc(100% - 48px)",maxWidth:380,zIndex:301,border:"1px solid #ff445544"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:44,marginBottom:8}}>🚨</div>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:"#ff6666"}}>Atenção necessária!</h2>
            <p style={{margin:"6px 0 0",fontSize:13,color:"#666"}}>{urgentes.length} alerta{urgentes.length>1?"s":"" } urgente{urgentes.length>1?"s":""}</p>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
            {urgentes.slice(0,3).map(n=>(
              <div key={n.id} style={{background:"#ff445515",borderRadius:12,padding:"12px 14px",borderLeft:"3px solid #ff4455"}}>
                <p style={{margin:0,fontWeight:700,fontSize:13,color:"#ff6666"}}>{n.icone} {n.titulo}</p>
                <p style={{margin:"3px 0 0",fontSize:12,color:"#aaa"}}>{n.desc}</p>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setPopupInicial(false);setAbaNotif(true);}}
              style={{...S.btn,flex:2,fontSize:14,padding:"13px"}}>Ver Detalhes</button>
            <button onClick={()=>setPopupInicial(false)}
              style={{...S.btnG,flex:1,fontSize:13}}>Fechar</button>
          </div>
        </div>
      </>
    );
  };

  // ══════════════════════════════════════════════════════════════
  //  NAVEGAÇÃO
  // ══════════════════════════════════════════════════════════════
  const NAV=[
    {id:"painel",       icone:"◉",  rot:"Início"},
    {id:"historico",    icone:"⊟",  rot:"Histórico"},
    {id:"adicionar",    icone:"⊕",  rot:"Adicionar"},
    {id:"estatisticas", icone:"◈",  rot:"Gráficos"},
    {id:"metas",        icone:"◎",  rot:"Metas"},
    {id:"contas",       icone:"🧾", rot:"Contas"},
    {id:"atlas-ia",     icone:"🤖", rot:"Atlas IA"},
  ];

  const contasUrgentes=notificacoes.filter(n=>n.tipo==="perigo").length;

  // ══════════════════════════════════════════════════════════════
  //  🎓 TOUR DE APRESENTAÇÃO
  // ══════════════════════════════════════════════════════════════
  const TOUR_STEPS=((nome)=>[
    {
      icone:"⚡",
      titulo:"Bem-vindo ao AtlasTrack!",
      desc:`Olá, ${nome}! Aqui você vai controlar suas finanças de forma simples e inteligente. Vamos fazer um tour rápido pelo app?`,
      cor:"#00E676",
      aba:null,
      dica:null,
    },
    {
      icone:"◉",
      titulo:"Início — seu painel central",
      desc:"No Início você vê seu saldo atual, receitas, despesas e as transações mais recentes. É a sua visão geral financeira de relance.",
      cor:"#45B7D1",
      aba:"painel",
      dica:"Fique de olho no card de saldo — ele fica vermelho quando você está no negativo!",
    },
    {
      icone:"⊕",
      titulo:"Adicionar transação",
      desc:"Aqui você registra tudo que entra e sai: mesada, compras, lanches, transporte. Mantenha atualizado para ter o controle real do seu dinheiro.",
      cor:"#00E676",
      aba:"adicionar",
      dica:"Dica: registre logo após gastar. Quanto mais completo, mais preciso seu saldo!",
    },
    {
      icone:"⊟",
      titulo:"Histórico",
      desc:"Consulte todas as suas transações com filtros por categoria, tipo e data. Ótimo para revisar onde o dinheiro foi parar.",
      cor:"#FFB347",
      aba:"historico",
      dica:"Use os filtros para encontrar gastos específicos rapidamente.",
    },
    {
      icone:"◈",
      titulo:"Gráficos & Estatísticas",
      desc:"Visualize seus gastos por categoria e mês. Os gráficos revelam padrões que você talvez não perceba no dia a dia.",
      cor:"#DDA0DD",
      aba:"estatisticas",
      dica:"O gráfico de rosca mostra onde você gasta mais — experimente analisar seus padrões!",
    },
    {
      icone:"◎",
      titulo:"Metas financeiras",
      desc:"Defina objetivos: notebook novo, festa, viagem... O app acompanha seu progresso e te avisa quando você está perto de atingir a meta!",
      cor:"#96CEB4",
      aba:"metas",
      dica:"Toda meta precisa de um prazo — isso cria um senso de urgência saudável!",
    },
    {
      icone:"🧾",
      titulo:"Contas a pagar",
      desc:"Cadastre contas com data de vencimento e receba alertas antes de vencer. Nunca mais esqueça uma conta!",
      cor:"#FF6B6B",
      aba:"contas",
      dica:"Contas recorrentes (mensais) se renovam automaticamente ao marcar como pagas.",
    },
    {
      icone:"🤖",
      titulo:"Atlas IA — seu assistente",
      desc:"Converse com a IA sobre suas finanças: ela analisa seus dados reais e dá conselhos personalizados, dicas de economia e responde suas dúvidas.",
      cor:"#87CEEB",
      aba:"atlas-ia",
      dica:"Pergunte coisas como: \"Como estão meus gastos?\" ou \"Me dê dicas para economizar.\"",
    },
    {
      icone:"🧠",
      titulo:"Perfil Financeiro",
      desc:"Logo após o tour você vai responder um questionário rápido. Ele identifica se você é Gastador, Equilibrado ou Econômico — e te ajuda a evoluir!",
      cor:"#FFD700",
      aba:null,
      dica:"O questionário se repete a cada 30 dias para acompanhar sua evolução.",
    },
    {
      icone:"🚀",
      titulo:"Tudo pronto!",
      desc:"Você conheceu todas as funcionalidades do AtlasTrack. Agora é hora de começar — registre sua primeira receita ou despesa e tome o controle das suas finanças!",
      cor:"#00E676",
      aba:null,
      dica:null,
    },
  ])(primeiroNome(usuario?.nome||""));

  const finalizarTour=()=>{
    setTourAtivo(false);
    setTourEtapa(0);
    setMostrarQ(true); // inicia questionário de perfil após o tour
  };

  const renderTour=()=>{
    if(!tourAtivo) return null;
    const step=TOUR_STEPS[tourEtapa];
    const total=TOUR_STEPS.length;
    const isUltimo=tourEtapa===total-1;
    const isPrimeiro=tourEtapa===0;

    // Troca a aba visível conforme o step (quando não é modal central)
    if(step.aba && aba!==step.aba) setAba(step.aba);

    return(
      <>
        {/* Overlay escurecido */}
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:400,backdropFilter:"blur(3px)"}}/>

        {/* Card do tour — posicionado na parte inferior */}
        <div style={{
          position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
          width:"100%",maxWidth:430,zIndex:401,
          background:"#161616",
          borderRadius:"28px 28px 0 0",
          padding:"24px 24px 36px",
          boxShadow:"0 -8px 48px rgba(0,0,0,0.6)",
          border:`1px solid ${step.cor}33`,
          borderBottom:"none",
          animation:"slideUpTour 0.35s cubic-bezier(.34,1.3,.64,1)",
        }}>
          {/* Barra de progresso */}
          <div style={{background:"#1e1e1e",borderRadius:4,height:4,marginBottom:22,overflow:"hidden"}}>
            <div style={{
              width:`${((tourEtapa+1)/total)*100}%`,height:"100%",
              background:`linear-gradient(90deg,${step.cor},${step.cor}aa)`,
              borderRadius:4,transition:"width 0.5s cubic-bezier(.34,1.3,.64,1)"
            }}/>
          </div>

          {/* Ícone + step counter */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{
              width:52,height:52,borderRadius:16,
              background:`${step.cor}22`,
              border:`1.5px solid ${step.cor}44`,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:26,
            }}>{step.icone}</div>
            <span style={{fontSize:12,color:"#444",fontWeight:700}}>{tourEtapa+1} / {total}</span>
          </div>

          {/* Título */}
          <h2 style={{margin:"0 0 10px",fontSize:20,fontWeight:900,color:step.cor,letterSpacing:-0.5,lineHeight:1.25}}>
            {step.titulo}
          </h2>

          {/* Descrição */}
          <p style={{margin:0,fontSize:14,color:"#aaa",lineHeight:1.65}}>
            {step.desc}
          </p>

          {/* Dica */}
          {step.dica&&(
            <div style={{
              marginTop:14,background:`${step.cor}12`,
              borderRadius:12,padding:"10px 14px",
              borderLeft:`3px solid ${step.cor}66`,
            }}>
              <p style={{margin:0,fontSize:12.5,color:step.cor,lineHeight:1.55}}>
                💡 {step.dica}
              </p>
            </div>
          )}

          {/* Botões de navegação */}
          <div style={{display:"flex",gap:10,marginTop:22}}>
            {!isPrimeiro&&(
              <button
                onClick={()=>setTourEtapa(e=>e-1)}
                style={{...S.btnG,flex:1,padding:"13px",fontSize:14}}>
                ← Voltar
              </button>
            )}
            <button
              onClick={isUltimo ? finalizarTour : ()=>setTourEtapa(e=>e+1)}
              style={{...S.btn,flex:2,fontSize:15,padding:"13px",background:step.cor}}>
              {isUltimo?"Começar agora! 🚀":"Próximo →"}
            </button>
          </div>

          {/* Pular tour */}
          {!isUltimo&&(
            <button
              onClick={finalizarTour}
              style={{display:"block",margin:"14px auto 0",background:"none",border:"none",color:"#333",fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
              Pular tour
            </button>
          )}
        </div>

        {/* Keyframe de animação via style tag */}
        <style>{`@keyframes slideUpTour{from{transform:translateX(-50%) translateY(100%);}to{transform:translateX(-50%) translateY(0);}}`}</style>
      </>
    );
  };

  return(
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
      {aviso&&<div style={S.toast(aviso.ok)}>{aviso.msg}</div>}

      {/* Tour de apresentação */}
      {renderTour()}

      {/* Popup de urgência */}
      {popupInicial&&!tourAtivo&&renderPopupUrgente()}

      {/* Drawer de notificações */}
      {abaNotif&&renderNotificacoes()}

      <div style={{overflowY:"auto",height:"100vh"}}>
        {aba==="painel"       &&renderPainel()}
        {aba==="adicionar"    &&renderAdicionar()}
        {aba==="historico"    &&renderHistorico()}
        {aba==="estatisticas" &&renderEstatisticas()}
        {(aba==="metas"||aba==="nova-meta")&&renderMetas()}
        {(aba==="contas"||aba==="nova-conta")&&renderContas()}
        {aba==="atlas-ia"     &&renderAtlasIA()}
      </div>
      <nav style={S.nav}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setAba(n.id)}
            style={{...S.navB(aba===n.id||(aba==="nova-meta"&&n.id==="metas")||(aba==="nova-conta"&&n.id==="contas")),position:"relative"}}>
            <span style={{fontSize:n.id==="adicionar"?24:n.id==="atlas-ia"||n.id==="contas"?15:18,lineHeight:1}}>{n.icone}</span>
            {/* Badge na aba contas */}
            {n.id==="contas"&&contasUrgentes>0&&(
              <div style={{...S.notifBadge,top:2,right:6}}>{contasUrgentes>9?"9+":contasUrgentes}</div>
            )}
            <span style={{fontSize:9,fontWeight:700,letterSpacing:0.2}}>{n.rot}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
