import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ProfissionalComponent } from './profissional';

describe('ProfissionalComponent', () => {
  let component: ProfissionalComponent;
  let fixture: ComponentFixture<ProfissionalComponent>;

  beforeEach(async () => {
    // jsdom não implementa IntersectionObserver
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver;

    await TestBed.configureTestingModule({
      imports: [ProfissionalComponent],
      providers: [provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfissionalComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});