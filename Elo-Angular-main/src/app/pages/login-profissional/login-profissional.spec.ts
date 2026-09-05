import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LoginProfissionalComponent } from './login-profissional';

describe('LoginProfissionalComponent', () => {
  let component: LoginProfissionalComponent;
  let fixture: ComponentFixture<LoginProfissionalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginProfissionalComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginProfissionalComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});