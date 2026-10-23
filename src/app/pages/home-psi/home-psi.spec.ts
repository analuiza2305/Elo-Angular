import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HomePsi } from './home-psi';

describe('HomePsi', () => {
  let component: HomePsi;
  let fixture: ComponentFixture<HomePsi>;

  beforeEach(async () => {
    localStorage.removeItem('homepsi_lastSection');

    await TestBed.configureTestingModule({
      imports: [HomePsi],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePsi);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deve iniciar na seção dashboard por padrão', () => {
    expect(component.activeSection()).toBe('dashboard');
  });

  it('deve trocar de seção e persistir a escolha em localStorage', () => {
    component.selecionarSecao('agenda');
    fixture.detectChanges();

    expect(component.activeSection()).toBe('agenda');
    expect(localStorage.getItem('homepsi_lastSection')).toBe('agenda');
  });

  it('deve alternar a sidebar ao chamar toggleSidebar', () => {
    expect(component.sidebarOpen()).toBe(false);
    component.toggleSidebar();
    expect(component.sidebarOpen()).toBe(true);
  });

  describe('Agenda', () => {
    it('deve navegar para o mês anterior e seguinte corretamente', () => {
      const mesInicial = component.currentMonth();
      const anoInicial = component.currentYear();

      component.mesSeguinte();
      if (mesInicial === 11) {
        expect(component.currentMonth()).toBe(0);
        expect(component.currentYear()).toBe(anoInicial + 1);
      } else {
        expect(component.currentMonth()).toBe(mesInicial + 1);
      }

      component.mesAnterior();
      expect(component.currentMonth()).toBe(mesInicial);
      expect(component.currentYear()).toBe(anoInicial);
    });

    it('não deve abrir o modal de horários para uma data passada', () => {
      component.currentMonth.set(0);
      component.currentYear.set(2000);

      component.abrirSelecaoHorarios(10);

      expect(component.modalHorariosAberto()).toBe(false);
      expect(component.mensagemAgenda()).toContain('anteriores a hoje');
    });

    it('deve exigir ao menos um horário selecionado para confirmar disponibilidade', () => {
      const hoje = new Date();
      component.currentMonth.set(hoje.getMonth());
      component.currentYear.set(hoje.getFullYear());

      component.abrirSelecaoHorarios(hoje.getDate());
      component.confirmarDisponibilidade();

      expect(component.mensagemAgenda()).toContain('Selecione pelo menos um horário');
      expect(component.modalHorariosAberto()).toBe(true);
    });

    it('deve fechar o modal ao cancelar', () => {
      const hoje = new Date();
      component.currentMonth.set(hoje.getMonth());
      component.currentYear.set(hoje.getFullYear());

      component.abrirSelecaoHorarios(hoje.getDate());
      expect(component.modalHorariosAberto()).toBe(true);

      component.fecharModalHorarios();
      expect(component.modalHorariosAberto()).toBe(false);
      expect(component.diaSelecionado()).toBeNull();
    });
  });
});