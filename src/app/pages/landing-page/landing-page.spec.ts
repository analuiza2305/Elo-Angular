import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as landingModule from './landing-page';

describe('LandingPage', () => {
  let component: any;
  let fixture: ComponentFixture<any>;

  beforeEach(async () => {
    // resolve exported component from the module (try common export names)
    const LandingComp = (landingModule as any).LandingPage || (landingModule as any).LandingPageComponent || (landingModule as any).default || Object.values(landingModule)[0];

    await TestBed.configureTestingModule({
      declarations: [LandingComp],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingComp);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
