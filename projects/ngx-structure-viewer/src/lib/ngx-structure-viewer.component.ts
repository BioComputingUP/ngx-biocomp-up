import { Component, ElementRef, Injector, Input, Optional, Output, SkipSelf, ViewChild } from '@angular/core';
import { ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
// Custom dependencies
import { RepresentationService } from './services/representation.service';
import { HighlightService, Highlights } from './services/highlight.service';
import { StructureService } from './services/structure.service';
import { SettingsService } from './services/settings.service';
import { PluginService } from './services/plugin.service';
import { CanvasService } from './services/canvas.service';
import { Interaction } from './interfaces/interaction';
import { Settings } from './interfaces/settings';
import { Source } from './interfaces/source';
import { Locus } from './interfaces/locus';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ngx-structure-viewer',
  // Handle dependencies
  imports: [
    CommonModule,
  ],
  providers: [
    // Mandatory providers
    RepresentationService,
    HighlightService,
    SettingsService,
    CanvasService,
    // Optional providers
    // NOTE Those are created for the instance only if they are not provided by the parent component
    {
      provide: StructureService,
      deps: [Injector, PluginService, [new Optional(), new SkipSelf(), StructureService],],
      useFactory: (parentInjector: Injector, pluginService: PluginService, structureService?: StructureService) => {
        // Case structure service is not provided, it must be created
        if (!structureService) {
          // Define injector for current component
          const childInjector = Injector.create({
            providers: [StructureService, { provide: PluginService, useValue: pluginService }],
            parent: parentInjector
          });
          // get injected service
          structureService = childInjector.get(StructureService);
        }
        // Return structure service
        return structureService;
      }
    },
    {
      provide: PluginService,
      deps: [Injector, [new Optional(), new SkipSelf(), PluginService]],
      useFactory: (parentInjector: Injector, pluginService?: PluginService) => {
        // Case plugin service is not provided, it must be created
        if (!pluginService) {
          // Define injector for current component
          const childInjector = Injector.create({
            providers: [PluginService],
            parent: parentInjector
          });
          // get injected service
          pluginService = childInjector.get(PluginService);
        }
        // Return plugin service
        return pluginService;
      }
    }
  ],
  standalone: true,
  // Handle representation
  templateUrl: './ngx-structure-viewer.component.html',
  styleUrls: [
    '../../../../node_modules/molstar/lib/mol-plugin-ui/skin/dark.scss',
    './ngx-structure-viewer.component.scss'
  ],
  encapsulation: ViewEncapsulation.None,
})
export class NgxStructureViewerComponent {

  @ViewChild('container')
  set container(container: ElementRef) {
    // Emit container
    this.canvasService.container = container;
  }

  @Input()
  set source(source: Source) {
    this.structureService.source = source;
  }

  @Input()
  set loci(loci: Locus[]) {
    this.representationService.loci = loci;
  }

  @Input()
  set interactions(interactions: Interaction[]) {
    this.representationService.interactions = interactions;
  }

  @Input()
  set settings(settings: Settings) {
    this.settingsService.settings = settings;
  }

  @Input()
  set highlights(highlights: Highlights) {
    this.highlightService.highlights = highlights;
  }

  // eslint-disable-next-line @angular-eslint/no-output-rename
  @Output('highlights')
  public highlights$ = this.highlightService.output$;

  constructor(
    public representationService: RepresentationService,
    public highlightService: HighlightService,
    public structureService: StructureService,
    public settingsService: SettingsService,
    public pluginService: PluginService,
    public canvasService: CanvasService,
  ) {
  }

}
