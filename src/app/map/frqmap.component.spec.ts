import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FrqmapComponent } from './frqmap.component';

describe('FrqmapComponent', () => {
  let component: FrqmapComponent;
  let fixture: ComponentFixture<FrqmapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ FrqmapComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(FrqmapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
