import { EventEmitter, Injectable } from '@angular/core';
import { Structure, StructureProperties } from 'molstar/lib/mol-model/structure';
import { StateObject, StateObjectSelector } from 'molstar/lib/mol-state';
import { StateTransformer } from 'molstar/lib/mol-state/transformer';
import { Asset } from 'molstar/lib/mol-util/assets';
import {
  BehaviorSubject,
  catchError,
  combineLatestWith,
  filter,
  from,
  Observable,
  of,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';
import { Source } from '../interfaces/source';
// Custom services
// import { SettingsService } from './settings.service';
import { MolstarService } from './molstar.service';
import { PluginService } from './plugin.service';
import { SettingsService } from './settings.service';

export type DataStateObject = Exclude<Awaited<ReturnType<StructureService['parseSource']>>, null>;

export type StructureStateObject = Awaited<ReturnType<StructureService['createStructure']>>;

@Injectable()
export class StructureService {

  readonly source$ = new BehaviorSubject<Source | null>(null);

  // Get current source
  public get source(): Source | null {
    return this.source$.value;
  }

  public set source(source: Source | null) {
    this.source$.next(source);
    this.isStructureLoaded = false;
  }

  public r2i!: Map<string, number>;

  public i2r!: Map<number, string>;

  // Define start, end indices for each chain
  public c2i!: Map<string, [number, number]>;

  // public residues!: Array<Residue>;
  public isStructureLoaded = false;

  readonly onStructureLoadFail$ = new EventEmitter<void>();

  readonly structure$: Observable<Awaited<ReturnType<typeof this.createStructure>>>;

  // Inner structure wrapper
  protected _structure!: Awaited<ReturnType<typeof this.createStructure>>;

  // Return structure content
  public get structure(): Structure {
    // Return structure object
    return this._structure.cell?.obj?.data as Structure;
  }

  constructor(
    public settingsService: SettingsService,
    public molstarService: MolstarService,
    public pluginService: PluginService,
  ) {
    // Combine all observables into a single one
    this.structure$ = this.pluginService.plugin$.pipe(
      // Subscribe to source changes
      combineLatestWith(this.source$),
      // tap(([plugin, source]) => console.log('plugin', plugin, 'source', source)),
      // Join source and plugin
      switchMap(([, source]) => {
        return from(this.parseSource(source)).pipe(
          catchError(() => {
            this.onStructureLoadFail$.emit();
            return of(null);
          }),
        );
      }),
      // Case data is defined
      filter((data): data is DataStateObject => !!data),
      // Generate trajectory
      switchMap((data) => from(this.createStructure(data, this.source!))),
      // Store structure wrapper
      tap((structure) => this._structure = structure),
      // Store mappings between residue and numeric index
      tap(() => this.setResidues(this.structure, this.settingsService.settings.prefer_label_asym_id)),
      // Set structure loaded flag, so we know that we can access structure
      tap(() => this.isStructureLoaded = true),
      // Cache results
      shareReplay(1),
    );
  }

  protected async parseSource(source: Source | null) {
    // Get plugin instance
    const plugin = this.pluginService.plugin;
    // Clear plugin state
    await plugin.clear();
    // Case source is defined
    if (source) {
      let data: StateObjectSelector<StateObject, StateTransformer> | null;
      // Case source is local
      if (source.type === 'local') {
        // Parse local source
        data = await this.parseLocalSource(source);
      } else {
        // Otherwise, source is remote
        data = await this.parseRemoteSource(source);

        if (data === undefined) {
          throw new Error('Failed to parse remote source');
        }
      }
      // Return data
      return data;
    }
    // Otherwise, return null
    return null;
  }

  protected async parseRemoteSource(source: Source & { type: 'remote' }) {
    // Import asset from MolStar
    const {Asset} = this.molstarService.molstar;
    // Define source properties
    const url = Asset.Url(source.link);
    const label = source.label;
    const binary = source.binary;
    // Define plugin instance
    const plugin = this.pluginService.plugin;
    // Retrieve remote data
    return plugin.builders.data.download({url, label, isBinary : binary});
  }

  protected async parseLocalSource(source: Source & { type: 'local' }) {
    // Import asset from MolStar
    const {Asset} = this.molstarService.molstar;
    // Define source label
    const binary = source.binary;
    const label = source.label;
    // Define plugin instance
    const plugin = this.pluginService.plugin;
    // Case source data is string, no need to read data as file
    if (typeof source.data === 'string') {
      // Read file from string
      return plugin.builders.data.rawData({data : source.data, label});
    }
    // Wrap blob into file
    let file: Asset.File;
    // Case source data is file
    if (source.data instanceof File) {
      // File is already available
      file = Asset.File(source.data);
    }
    // Othwerwise, data must be read as file
    else {
      // Get file name
      const ext = source.format === 'mmcif' ? 'cif' : 'ent';
      const name = `${label}.${ext}`;
      // Generate file
      file = Asset.File(new File([source.data], name));
    }
    // Return data read from file
    const {data} = await plugin.builders.data.readFile({file, label, isBinary : binary});
    // Return retrieved data
    return data;
  }

  protected async createStructure(data: DataStateObject, source: Source) {
    // Define plugin instance
    const plugin = this.pluginService.plugin;
    // Parse data
    const parsed = await plugin.builders.structure.parseTrajectory(data, source.format);
    // Create model
    const model = await plugin.builders.structure.createModel(parsed, {modelIndex : 0});
    // Create structure
    return plugin.builders.structure.createStructure(model, {name : 'model', params : {}});
  }

  protected setResidues(structure: Structure, prefer_label_asym_id = false): void {
    // Initialize index
    let index = 0;
    // Initialize map between residue (sequence number, insertion code) to numeric index
    const r2i = this.r2i = new Map();
    const i2r = this.i2r = new Map();
    // Initialize map between chain identifier to start, end indices
    const c2i = this.c2i = new Map();
    // Loop through each residue
    Structure.eachAtomicHierarchyElement(structure, ({
      residue : (r) => {
        // Define residue index
        const authSeqId = StructureProperties.residue.auth_seq_id(r);
        // Get insertion code
        const pdbInsCode = StructureProperties.residue.pdbx_PDB_ins_code(r);
        // Define residue name
        const authAsymId = prefer_label_asym_id ? StructureProperties.chain.label_asym_id(r) : StructureProperties.chain.auth_asym_id(r);
        // Define residue unique identifier
        const identifier = (authAsymId + authSeqId + pdbInsCode).trim();
        // Map residue id to its index
        r2i.set(identifier, index);
        i2r.set(index, identifier);
        // Get chain start, end indices
        const [cs] = c2i.get(authAsymId) || [index, index];
        // Update chain start, end indices
        this.c2i.set(authAsymId, [cs, index]);
        // Update index
        index++;
      },
    }));
  }

}
