import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnuncioEspacoComponent } from './anuncio-espaco';
import { Anuncio, DivulgacaoService } from '../../services/divulgacao';

@Component({
  standalone: true,
  imports: [AnuncioEspacoComponent],
  template: `<app-anuncio-espaco posicao="forum"></app-anuncio-espaco>`,
})
class Hospedeira {}

function anuncio(extra: Partial<Anuncio> = {}): Anuncio {
  return {
    id: 'a1', parceiroId: 'p1', nomeEmpresa: 'Clínica Amora', itemId: 'i', itemNome: 'Anúncio mensal',
    titulo: 'Primeira consulta gratuita', texto: 'Agende pelo site', imagem: '', link: 'https://exemplo.com/oferta',
    posicao: 'forum', status: 'ativo', inicio: null, fim: null, recorrente: true, valor: 99.9, periodicidade: 'mensal',
    duracaoDias: 30, renovacoes: 0, impressoes: 0, cliques: 0, criadoEm: null, noAr: true, ...extra,
  };
}

async function montar(retorno: Anuncio | null) {
  const fake = {
    anuncioParaExibir: vi.fn().mockResolvedValue(retorno),
    registrarImpressao: vi.fn().mockResolvedValue(undefined),
    registrarClique: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({ imports: [Hospedeira], providers: [{ provide: DivulgacaoService, useValue: fake }] });
  const fixture = TestBed.createComponent(Hospedeira);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, fake, el: fixture.nativeElement as HTMLElement };
}

describe('AnuncioEspacoComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('mostra o anúncio com a etiqueta "Anúncio" e conta a exibição', async () => {
    const { el, fake } = await montar(anuncio());
    expect(el.querySelector('.ad-etiqueta')?.textContent).toContain('Anúncio');
    expect(el.querySelector('.ad-etiqueta')?.textContent).toContain('Clínica Amora');
    expect(el.querySelector('strong')?.textContent).toContain('Primeira consulta gratuita');
    expect(fake.registrarImpressao).toHaveBeenCalledTimes(1);
  });

  it('o link abre em outra aba, sem referrer, marcado como patrocinado, e conta o clique', async () => {
    const { el, fake } = await montar(anuncio());
    const a = el.querySelector('a.ad-corpo') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://exemplo.com/oferta');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('sponsored');
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    expect(fake.registrarClique).toHaveBeenCalledTimes(1);
  });

  it('bloqueia link javascript: (vira um bloco sem link)', async () => {
    const { el } = await montar(anuncio({ link: 'javascript:alert(1)' }));
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('.ad-corpo')).not.toBeNull();
    expect(el.querySelector('.ad-cta')).toBeNull();
  });

  it('sem anúncio no ar, o espaço não desenha nada', async () => {
    const { el, fake } = await montar(null);
    expect(el.querySelector('aside')).toBeNull();
    expect(fake.registrarImpressao).not.toHaveBeenCalled();
  });
});
