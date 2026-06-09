import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';

import { FrqmapComponent } from './frqmap.component';

describe('FrqmapComponent', () => {
  let component: FrqmapComponent;
  let fixture: ComponentFixture<FrqmapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ FrqmapComponent ],
      imports: [ FormsModule ],          // template uses [(ngModel)]
      providers: [ provideHttpClient() ], // component injects HttpClient
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
