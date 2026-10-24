import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HomeAdv } from './home-adv';

describe('HomeAdv', () => {
  let component: HomeAdv;
  let fixture: ComponentFixture<HomeAdv>;

  beforeEach(async () => {
    localStorage.removeItem('homeadv_lastSection');

    await TestBed.configureTestingModule({
      imports: [HomeAdv],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeAdv);
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
    expect(localStorage.getItem('homeadv_lastSection')).toBe('agenda');
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

    it('não deve avançar se o horário final for antes do inicial', () => {
      component.adicionarConsulta();
      component.horaInicioExpediente.set('18:00');
      component.horaFimExpediente.set('08:00');

      component.avancarParaDuracaoSessao();

      expect(component.erroPeriodo()).toContain('depois do inicial');
      expect(component.modalConfigPeriodoAberto()).toBe(true);
    });

    it('não deve gerar horário que termina depois do expediente', () => {
      const hoje = new Date();
      component.currentMonth.set(hoje.getMonth());
      component.currentYear.set(hoje.getFullYear() + 1);
      component.horaInicioExpediente.set('08:00');
      component.horaFimExpediente.set('10:00');
      component.duracaoSessao.set(45);

      component.abrirSelecaoHorarios(1);

      expect(component.horariosDoDia().map((h) => h.horario)).toEqual(['08:00', '08:45']);
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