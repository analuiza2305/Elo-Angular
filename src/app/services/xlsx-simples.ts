/**
 * Gerador de planilha Excel (.xlsx) sem bibliotecas externas.
 *
 * Um .xlsx é um arquivo .zip com alguns XML dentro. Aqui montamos esses XML
 * (com estilos prontos na paleta do Elo Materno) e empacotamos num zip simples
 * (sem compressão), que o Excel, o Google Planilhas e o LibreOffice abrem normalmente.
 *
 * Uso:
 *   const blob = gerarXlsx([{ nome: 'Resumo', colunas: [20, 12], linhas: [[{ v: 'Título', s: 'titulo' }]] }]);
 */

export type EstiloCelula =
  | 'normal' | 'titulo' | 'subtitulo' | 'secao' | 'cabecalho'
  | 'texto' | 'textoZebra' | 'numero' | 'numeroZebra' | 'porcento' | 'porcentoZebra'
  | 'kpiRotulo' | 'kpiValor' | 'kpiDica' | 'kpiDestaqueRotulo' | 'kpiDestaqueValor' | 'kpiDestaqueDica'
  | 'total' | 'totalNumero' | 'totalPorcento' | 'nota' | 'situacaoOk' | 'situacaoProx';

export interface Celula { v: string | number | null; s?: EstiloCelula }

export interface ImagemPlanilha {
  png: Uint8Array;      // bytes do PNG
  col: number;          // coluna (0 = A) do canto superior esquerdo
  linha: number;        // linha (0 = 1) do canto superior esquerdo
  largura: number;      // em pixels
  altura: number;       // em pixels
}

export interface AbaPlanilha {
  nome: string;
  colunas: number[];                       // largura de cada coluna (em "caracteres")
  linhas: (Celula | null)[][];
  alturas?: Record<number, number>;        // índice da linha (0 = 1) -> altura em pontos
  mesclar?: string[];                      // ex.: 'A1:H1'
  imagens?: ImagemPlanilha[];
  congelarLinhas?: number;                 // quantas linhas do topo ficam fixas ao rolar
  corAba?: string;                         // ex.: '7C5FCB'
}

// ---------------------------------------------------------------------------
// ESTILOS (ordem = índice no styles.xml)
// ---------------------------------------------------------------------------
const ESTILOS: EstiloCelula[] = [
  'normal', 'titulo', 'subtitulo', 'secao', 'cabecalho',
  'texto', 'textoZebra', 'numero', 'numeroZebra', 'porcento', 'porcentoZebra',
  'kpiRotulo', 'kpiValor', 'kpiDica', 'kpiDestaqueRotulo', 'kpiDestaqueValor', 'kpiDestaqueDica',
  'total', 'totalNumero', 'nota', 'situacaoOk', 'situacaoProx', 'totalPorcento',
];

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
<fonts count="13">
<font><sz val="11"/><color rgb="FF2D1E4E"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="22"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FFE9E0FF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="13"/><color rgb="FF3E2A72"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FF6B5E8E"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="24"/><color rgb="FF5B3D99"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="9"/><color rgb="FF8A80A8"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFEDE6FF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="24"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="9"/><color rgb="FFE3D9FF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF3E2A72"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FF2F7A55"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="10">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF5B3D99"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF7C5FCB"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7F3FE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1EBFD"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF6E54B5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE4DAF9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7F6EE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4EEFD"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFE6DEF7"/></left><right style="thin"><color rgb="FFE6DEF7"/></right><top style="thin"><color rgb="FFE6DEF7"/></top><bottom style="thin"><color rgb="FFE6DEF7"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FFB9A6E3"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFB9A6E3"/></left><right style="thin"><color rgb="FFB9A6E3"/></right><top style="medium"><color rgb="FF7C5FCB"/></top><bottom style="thin"><color rgb="FFB9A6E3"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${ESTILOS.length}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" indent="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="bottom"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" indent="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" indent="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="bottom" indent="1"/></xf>
<xf numFmtId="1" fontId="6" fillId="5" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="7" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="1"/></xf>
<xf numFmtId="0" fontId="8" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="bottom" indent="1"/></xf>
<xf numFmtId="1" fontId="9" fillId="6" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="10" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1" indent="1"/></xf>
<xf numFmtId="0" fontId="11" fillId="7" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
<xf numFmtId="1" fontId="11" fillId="7" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="12" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="11" fillId="7" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---------------------------------------------------------------------------
// XML das abas
// ---------------------------------------------------------------------------
function letraColuna(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // remove caracteres de controle que o Excel não aceita
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function xmlAba(aba: AbaPlanilha, idDesenho: string | null): string {
  const cols = aba.colunas.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const linhas = aba.linhas.map((linha, r) => {
    const alt = aba.alturas?.[r];
    const celulas = linha.map((c, ci) => {
      if (!c) return '';
      const ref = `${letraColuna(ci)}${r + 1}`;
      const s = ESTILOS.indexOf(c.s || 'normal');
      if (c.v === null || c.v === '') return `<c r="${ref}" s="${s}"/>`;
      if (typeof c.v === 'number' && isFinite(c.v)) return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}"${alt ? ` ht="${alt}" customHeight="1"` : ''}>${celulas}</row>`;
  }).join('');
  const mesclar = aba.mesclar?.length ? `<mergeCells count="${aba.mesclar.length}">${aba.mesclar.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const painel = aba.congelarLinhas
    ? `<pane ySplit="${aba.congelarLinhas}" topLeftCell="A${aba.congelarLinhas + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr>${aba.corAba ? `<tabColor rgb="FF${aba.corAba}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView showGridLines="0" workbookViewId="0">${painel}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${cols}</cols>
<sheetData>${linhas}</sheetData>
${mesclar}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
${idDesenho ? `<drawing r:id="${idDesenho}"/>` : ''}
</worksheet>`;
}

function xmlDesenho(imagens: ImagemPlanilha[]): string {
  const EMU = 9525;
  const ancoras = imagens.map((im, i) => `<xdr:oneCellAnchor>
<xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${im.linha}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:ext cx="${Math.round(im.largura * EMU)}" cy="${Math.round(im.altura * EMU)}"/>
<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Grafico ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip r:embed="rImg${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(im.largura * EMU)}" cy="${Math.round(im.altura * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>
<xdr:clientData/></xdr:oneCellAnchor>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${ancoras}</xdr:wsDr>`;
}

// ---------------------------------------------------------------------------
// ZIP (sem compressão)
// ---------------------------------------------------------------------------
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(dados: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipar(arquivos: { nome: string; dados: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome);
    const crc = crc32(a.dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true); local.setUint32(18, a.dados.length, true); local.setUint32(22, a.dados.length, true);
    local.setUint16(26, nome.length, true); local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, a.dados);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, a.dados.length, true); cd.setUint32(24, a.dados.length, true);
    cd.setUint16(28, nome.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nome);
    offset += 30 + nome.length + a.dados.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, offset, true);
  const tudo = [...partes, ...central, new Uint8Array(fim.buffer)];
  const total = tudo.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of tudo) { saida.set(p, pos); pos += p.length; }
  return saida;
}

// ---------------------------------------------------------------------------
// Montagem final
// ---------------------------------------------------------------------------
export function gerarXlsx(abas: AbaPlanilha[], titulo = 'Relatório Elo Materno'): Blob {
  const enc = new TextEncoder();
  const arquivos: { nome: string; dados: Uint8Array }[] = [];
  const add = (nome: string, texto: string) => arquivos.push({ nome, dados: enc.encode(texto) });

  let totalImagens = 0;
  const tiposConteudo: string[] = [];
  abas.forEach((aba, i) => {
    const n = i + 1;
    tiposConteudo.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    const temImagens = !!aba.imagens?.length;
    add(`xl/worksheets/sheet${n}.xml`, xmlAba(aba, temImagens ? 'rDesenho1' : null));
    if (temImagens) {
      add(`xl/worksheets/_rels/sheet${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDesenho1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`);
      add(`xl/drawings/drawing${n}.xml`, xmlDesenho(aba.imagens!));
      tiposConteudo.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      const rels = aba.imagens!.map((im, k) => {
        totalImagens += 1;
        arquivos.push({ nome: `xl/media/image${totalImagens}.png`, dados: im.png });
        return `<Relationship Id="rImg${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${totalImagens}.png"/>`;
      }).join('');
      add(`xl/drawings/_rels/drawing${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
    }
  });

  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${tiposConteudo.join('\n')}
</Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`);
  add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(titulo)}</dc:title><dc:creator>Elo Materno</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>
</cp:coreProperties>`);
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${abas.map((a, i) => `<sheet name="${esc(a.nome.slice(0, 31))}" sheetId="${i + 1}" r:id="rAba${i + 1}"/>`).join('')}</sheets>
</workbook>`);
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${abas.map((_, i) => `<Relationship Id="rAba${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  add('xl/styles.xml', STYLES_XML);

  const bytes = zipar(arquivos);
  return new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Converte um dataURL (ex.: canvas.toDataURL()) em bytes PNG. */
export function bytesDeDataUrl(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
