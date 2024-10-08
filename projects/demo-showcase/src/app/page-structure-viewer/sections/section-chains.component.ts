import { ThemeSelectorService } from '../../theme-selector/theme-selector.service';
import { Locus, Settings, Source } from '@ngx-structure-viewer';
import { Observable, interval, map, shareReplay, startWith } from 'rxjs';
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-section-chains',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './section-chains.component.html',
  styleUrl: './section-chains.component.scss',
})
export class SectionChainsComponent {

  readonly settings$: Observable<Partial<Settings>>;

  // Default settings
  private readonly settings: Partial<Settings> = {
    'background-color': '#2b3035ff',
    'backbone-color': '#6ea8fecc',
    'interaction-color': '#ff0000ff',
    'interaction-size': 1,
    prefer_label_asym_id: true,
  };

  readonly source: Source;

  readonly chains$: Observable<Locus[]>;

  constructor(
    public themeSelectorService: ThemeSelectorService,
  ) {
    const theme$ = this.themeSelectorService.theme$;
    // Define settings
    this.settings$ = theme$.pipe(
      // Overwrite default settings
      map((theme) => ({
        ...this.settings,
        'background-color': theme === 'light' ? '#f8f9fa' : '#2b3035',
        'backbone-color': theme === 'light' ? '#2b3035' : '#f8f9fa',
      })),
      // Cache results
      shareReplay(1),
    );

    // Define source retrieval pipeline
    this.source = {
      type: 'remote' as const,
      format: 'mmcif' as const,
      label: '8VAP',
      binary: false,
      link: 'https://files.rcsb.org/download/3D0A.cif',
    };

    const chains = [
      { chain: 'A', color: '#6f42c1' },
      { chain: 'B', color: '#0d6efd' },
      { chain: 'C', start: '8', end: '8', color: '#dc3545' },
      { chain: 'D', color: '#ffc107' },
      { chain: 'E', color: '#28a745' },
      { chain: 'F', color: '#17a2b8' },
      { chain: 'G', color: '#fd7e14' },
      { chain: 'H', color: '#de14fd' },
    ];
    // Define chains observable
    this.chains$ = interval(123123123).pipe(
      // Get only colors
      map(() => chains.map(item => item.color)),
      // Shuffle colors
      map((colors) => colors.sort(() => Math.random() - 0.5)),
      // Re-build a list of colored chains
      map((colors) => colors.map((color, i) => ({ ...chains[i], color }))),
      // Start with first list
      startWith(chains),
      // Cache result
      shareReplay(1),
    );
  }

}
