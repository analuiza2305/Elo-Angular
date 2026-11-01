import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { VideochamadaComponent } from './videochamada';

describe('VideochamadaComponent', () => {
  let component: VideochamadaComponent;
  let fixture: ComponentFixture<VideochamadaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VideochamadaComponent],
      providers: [provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();

    fixture = TestBed.createComponent(VideochamadaComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
