import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
// Custom dependencies
// import { StructureService } from './services/structure.service';
// import { PluginService } from './services/plugin.service';
import { Settings } from './interfaces/settings';
import { Source } from './interfaces/source';
import { Locus } from './interfaces/locus';

// Custom dependencies
import { RepresentationService } from './services/representation.service';
// import { HighlightService } from './services/highlight.service';
import { StructureService } from './services/structure.service';
import { SettingsService } from './services/settings.service';
import { MolstarService } from './services/molstar.service';
import { PluginService } from './services/plugin.service';
import { BehaviorSubject, combineLatestWith, map, Observable, shareReplay, startWith, tap } from 'rxjs';
// import { Interaction } from './interfaces/interaction';
// import { Settings } from './interfaces/settings';
// import { Source } from './interfaces/source';
// import { Locus } from './interfaces/locus';
// import { map, shareReplay } from 'rxjs';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ngx-structure-viewer',
  styleUrl: './ngx-structure-viewer.component.scss',
  template: '<div [style.background-color]="background$ | async" #container></div>',
  // Handle dependencies
  imports: [ CommonModule ],
  providers: [
    RepresentationService,
    // HighlightService,
    StructureService,
    SettingsService,
    MolstarService,
    PluginService,
  ],
  standalone: true,
})
export class NgxStructureViewerComponent implements AfterViewInit, OnChanges {

  @ViewChild('container')
  public container!: ElementRef;

  // @Input()
  // set source(source: Source) {
  //   this.structureService.source = source;
  // }

  // @Input()
  // set loci(loci: Locus[]) {
  //   this.representationService.loci = loci;
  // }

  // @Input()
  // set interactions(interactions: Interaction[]) {
  //   this.representationService.interactions = interactions;
  // }

  // @Input()
  // set settings(settings: Settings) {
  //   this.settingsService.settings = settings;
  // }

  // // @Input()
  // // set highlights(highlights: Highlights) {
  // //   this.highlightService.highlights = highlights;
  // // }

  // // eslint-disable-next-line @angular-eslint/no-output-rename
  // @Output('highlights')
  // public highlights$ = this.highlightService.output$;

  // public background$ = this.settingsService.settings$.pipe(
  //   // Extract background color
  //   map((settings) => settings['background-color']),
  //   // Cache result
  //   shareReplay(1),
  // );

  @Input() settings!: Partial<Settings> | null;

  @Input() source!: Source | null;

  @Input() loci!: Locus[] | null;

  @Output() structureLoadFail$ = this.structureService.onStructureLoadFail$;

  // Allow acces to background color in background
  public background$ = this.settingsService.settings$.pipe(
    // Wait for pluing to be loaded
    combineLatestWith(this.pluginService.plugin$),
    // Extract background color
    map(([settings]) => settings['background-color']),
    // Start with transparent background
    startWith('transparent'),
    // Cache result
    shareReplay(1),
  );

  constructor(
    public representationService: RepresentationService,
    // public highlightService: HighlightService,
    public structureService: StructureService,
    public settingsService: SettingsService,
    public molstarService: MolstarService,
    public pluginService: PluginService,
  ) {
  }

  public ngOnChanges(changes: SimpleChanges): void {
    // Handle settings changes
    if (changes['settings']) {
      // Get default settings
      const { DEFAULT } = this.settingsService;
      // Initialize settings
      const settings = this.settings || {};
      // Emit settings
      this.settingsService.settings$.next({ ...DEFAULT,...settings });
    }
    // Handle source changes
    if (changes['source']) {
      // Emit source
      this.structureService.source = this.source;
    }
    // Handle loci changes
    if (changes['loci']) {
      // Emit loci
      this.representationService.loci$.next(this.loci || []);
    }
  }

  public ngAfterViewInit(): void {
    // Emit container
    this.pluginService.container$.next(this.container);
  }

}
