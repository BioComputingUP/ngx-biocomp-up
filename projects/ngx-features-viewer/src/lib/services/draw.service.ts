// Common
import { EventEmitter, Injectable } from '@angular/core';
import * as d3 from 'd3';
import { BaseType } from 'd3';
import { combineLatest, map, Observable, ReplaySubject, shareReplay, switchMap, tap, throttleTime } from 'rxjs';
import { Continuous } from '../features/continuous';
import { DSSP, DSSPPaths, dsspShape } from "../features/dssp";
import { Feature } from '../features/feature';
import { Locus } from '../features/locus'
import { Pin } from "../features/pin";
import { Sequence, sequenceColors } from "../sequence";
// Data types
import { InternalTrace, InternalTraces } from '../trace';
import { FeaturesService } from './features.service';
// Services
import { InitializeService, SelectionContext } from './initialize.service';
import { TooltipService } from './tooltip.service';

type SequenceContainer = d3.Selection<SVGGElement, Sequence, SVGGElement, undefined>;

type LabelGroup = d3.Selection<SVGGElement | d3.BaseType, InternalTrace, SVGGElement | d3.BaseType, InternalTraces>;

type TraceGroup = d3.Selection<SVGGElement | d3.BaseType, InternalTrace, SVGGElement, undefined>;

type GridLines = d3.Selection<SVGGElement | d3.BaseType, InternalTrace, SVGGElement | d3.BaseType, InternalTraces>;


// Get size of 1rem in pixel
// https://stackoverflow.com/questions/36532307/rem-px-in-javascript
export const REM = parseFloat(getComputedStyle(document.documentElement).fontSize);

// Define function for extracting identifier out of unknown object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const identity = (f: InternalTrace) => {
  return f.id;
};

// Define function for extracting index out of unknown object
export const index = (f: InternalTraces) => {
  return f.map((t) => t.id).join('-');
};

const alreadyExitedFromView = new Set<Feature>();

@Injectable({providedIn : 'platform'})
export class DrawService {

  public readonly traces$ = new ReplaySubject<InternalTraces>(1);

  public readonly sequence$ = new ReplaySubject<Sequence>(1);

  public readonly selectedFeatureEmit$ = new EventEmitter<SelectionContext | undefined>();

  public readonly selectedFeature$: Observable<SelectionContext | undefined>;

  public 'group.residues'!: SequenceContainer;

  public 'group.dots'!: SequenceContainer;

  public 'group.labels'!: LabelGroup;

  public 'group.traces'!: TraceGroup;

  public 'group.grid'!: GridLines;

  public sequenceCharWidth = 0.0;
  public featureLabelCharWidth = 0.0;

  public tooltip!: d3.Selection<HTMLDivElement, unknown, null, unknown>;

  /** Draw features
   *
   * This pipeline initialize features within the drawable aread
   * of the main SVG container, defined by the `draw` property.
   */
  public readonly draw$: Observable<unknown>;

  /** Update features
   *
   * This pipeline moves previously initialized features within the
   * drawable area, according to given scale (the one produced
   * after the zoom event took place)
   */
  public readonly drawn$: Observable<unknown>;

  private coilPoints = new Map<string, number[]>();

  constructor(
    private initializeService: InitializeService,
    private featuresService: FeaturesService,
    private tooltipService: TooltipService,
  ) {
    // Define draw initialization
    this.draw$ = combineLatest([this.initializeService.initialized$, this.sequence$]).pipe(
      // Update horizontal scale domain
      tap(([, sequence]) => {
        // Get horizontal scale
        const x = this.initializeService.scale.x;
        // Generate horizontal domain for sequence
        const domain = [0, sequence.length + 1];
        // Update horizontal scale
        x.domain(domain);
      }),
      tap(() => this.calculateCharWidth()),
      // Draw sequence
      map(([, sequence]) => this.createSequence(sequence)),
      // Initialize brush region
      tap(() => this.createBrush()),
      // Initialize tooltip
      tap(() => this.createTooltip()),
      // Cache result
      shareReplay(1),
      // Switch to traces emission
      switchMap(() => this.traces$),
      // Update vertical scale
      tap((traces: InternalTraces) => this.updateScale(traces)),
      // Draw labels, without setting position but saving references
      tap((traces: InternalTraces) => this.setLabelsPosition(traces)),
      // Draw grid, without setting position but saving references
      tap((traces: InternalTraces) => this.createGrid(traces)),
      // Draw features, without setting position but saving references
      tap((traces: InternalTraces) => this.createTraces(traces)),
      // NOTE This is required to avoid re-drawing everything on each resize/zoom event
      shareReplay(1),
    );
    // Define draw update
    this.drawn$ = combineLatest([this.draw$, this.initializeService.settings$]).pipe(
      // Move sequence residues in correct position
      tap(() => this.updateSequence()),
      // Move grid in correct position
      tap(() => this.updateGrid()),
      // Move traces in correct position
      map(() => this.updateTraces()),
      // Move the selection shadow in correct position
      map(() => this.updateShadowPosition()),
    );

    this.selectedFeature$ = this.selectedFeatureEmit$.pipe(
      // Debounce the event to avoid multiple updates in a short time
      throttleTime(300),
      tap((selectionContext) => {
        if (selectionContext) {
          this.setSelectionShadow(selectionContext);
        } else {
          this.removeSelectionShadow();
        }
      }),
      shareReplay(1),
    );
  }

  private calculateCharWidth() {
    const settings = this.initializeService.settings;
    // Get the width of the character 'A' in the sequence
    const text = this.initializeService.draw.append('text').attr('class', 'sequence').text('A');
    const bbox = text.node()!.getBBox();
    this.sequenceCharWidth = bbox.width;
    text.remove();

    // Get the width of the character 'A' in the feature label
    const text2 = this.initializeService.draw.append('text').attr('class', 'feature').text('A');
    const bbox2 = text2.node()!.getBBox();
    this.featureLabelCharWidth = bbox2.width;
    text2.remove();

    // Get the width of the character 'A' in the x-axis
    const text3 = this.initializeService.draw.append('text').attr('class', 'tick').text('A');
    const bbox3 = text3.node()!.getBBox();
    const xAxisXCharHeight = bbox3.height;
    text3.remove();

    // Update the margin bottom to accommodate at least the height of the character of the x-axis
    if (settings['x-axis-show'] !== false) {
      const settings = this.initializeService.settings;
      settings['margin-bottom'] = Math.max(settings['margin-bottom'], xAxisXCharHeight + 6);
    }
  }

  // Update vertical scale
  private updateScale(traces: InternalTraces): void {
    const axis = this.initializeService.axes;
    const scale = this.initializeService.scale;
    const sequence = this.initializeService.sequence;
    const settings = this.initializeService.settings;
    // Update domain
    const domain = ['sequence', ...traces.map(({id}) => id + '')];
    // Initialize range
    const range = [settings['margin-top']];
    // Set sequence line height
    if ((Array.isArray(sequence) || (typeof sequence === 'string')) && settings['sequence-show'] != false) {
      range.push(settings['margin-top'] + settings['line-height'])
    } else {
      range.push(settings['margin-top']);
    }

    // take the first trace and add its margin-top if defined
    const firstTrace = traces[0];
    const firstTraceMt = firstTrace.options?.['margin-top'] || 0;
    range[1] += firstTraceMt;

    // Calculate range adding the margin-bottom of the previous trace, the line-height of the current trace and the margin-top of the next trace
    for (let i = 1 ; i < domain.length ; i++) {
      const trace = this.featuresService.getTrace(+domain[i]);
      const nextTrace = this.featuresService.getTrace(+domain[i + 1]);

      const prevSpace = range[range.length - 1];
      const traceMb = trace?.options?.['margin-bottom'] || 0;
      const lh = trace?.options?.['line-height'] || settings['line-height'];
      const nextTraceMt = nextTrace?.options?.['margin-top'] || 0;

      range.push(prevSpace + traceMb + nextTraceMt + lh);
    }

    // Apply updates
    scale.y.domain(domain).range(range);
    // Translate x axis position
    axis.x.attr('transform', `translate(0, ${range[range.length - 1]})`);
    if (settings['x-axis-show'] === false) {
      axis.x.style('display', 'none');
    }
  }

  private createTooltip() {
    this.tooltip = this.tooltipService._tooltip;
  }

  private createSequence(sequence: Sequence) {
    // Initialize residues group
    const group = this.initializeService.draw
      // Select previous residues group
      .selectAll('g.sequence')
      // Bind residues group to sequence
      .data<Sequence>([sequence])
      // Create current residues group
      .join('g')
      .attr('class', 'sequence');

    // Create residues container inside the sequence group
    this['group.residues'] = group
      .append('g')
      .attr('class', 'residues');

    this['group.dots'] = group
      .append('g')
      .attr('class', 'dots');
  }

  private updateSequence() {
    // Get the sequence and from the sequence the residues
    const sequence = this.initializeService.sequence;
    const settings = this.initializeService.settings;
    const residues = parseSequence(sequence);

    // The list of residues can be empty in the case the sequence is a length only
    if (residues.length === 0 || (settings['sequence-show'] === false)) {
      return;
    }

    // Get scale (x, y axis)
    const {x, y} = this.initializeService.scale;
    // Get line height
    const lh = this.initializeService.settings["line-height"];
    const cs = this.initializeService.settings["content-size"];
    // Define container/cell width and (maximum) text width
    const cellWidth = x(1) - x(0);
    // Get maximum character width
    const charWidth = this.sequenceCharWidth;
    // Define residues group
    const residuesContainer = this['group.residues'];
    const dotsContainer = this['group.dots'];

    const domainStart = x.domain()[0];
    const domainEnd = x.domain()[1];

    if (charWidth + 0.5 > cellWidth) {
      // Remove residues if dots are to be shown
      residuesContainer.selectAll('*').remove();

      // Calculate number of dots needed
      const domainLength = domainEnd - domainStart;

      // Calculate how many cells are needed for each dot
      const spacing = 2;
      const bits = domainLength * cellWidth / charWidth / spacing;
      const bitSize = domainLength / bits + 1;

      const xPositions = d3.range(domainStart, domainEnd, bitSize).map((i) => x(i + bitSize / 2));

      // Create or update dots
      dotsContainer
        .selectAll('text.dot')
        .data(xPositions)
        .join('text')
        .attr('class', 'dot')
        .text('.')
        .attr('x', d => d)
        .attr('y', y('sequence') + lh / 2)
        .attr('width', charWidth)
        .attr('height', lh)
        .attr('dominant-baseline', 'central')
        .style('text-anchor', 'middle');
    } else {
      // Ensure dots are removed if residues are to be shown
      this['group.dots'].selectAll('*').remove();

      const domainStartFloor = Math.floor(domainStart + .5);
      const domainEndCeil = Math.min(Math.ceil(domainEnd), residues.length);

      const visibleResidues = residues.slice(Math.max(0, domainStartFloor - 1), domainEndCeil);

      // Create the visible residues inside the residues container as rect with the color of the residue
      if (settings["sequence-background-color"]) {
        const color = (d: string) => sequenceColors[settings["sequence-background-color"]!][d as never] || sequenceColors[settings["sequence-background-color"]!].X;
        let height;
        let yValue: number = y('sequence');

        switch (settings["sequence-background-height"]) {
          case '100%':
            height = '100%';
            break;
          case 'content-size':
            height = cs;
            yValue += (lh - cs) / 2;
            break;
          case 'line-height':
            height = lh;
            break;
          default:
            height = cs;
        }

        residuesContainer
          .selectAll('rect.residue')
          .data(visibleResidues)
          .join('rect')
          .attr('class', 'residue')
          .attr('x', (d, i) => x(i + domainStartFloor - .5))
          .attr('y', yValue)
          .attr('width', cellWidth)
          .attr('height', height)
          .attr('fill', color)
          .attr('fill-opacity', settings["sequence-background-opacity"] || 0.5);
      }

      // Create the visible residues inside the residues container as text elements
      residuesContainer
        .selectAll('text.residue')
        .data(visibleResidues)
        .join('text')
        .attr('class', 'residue')
        .text((d) => '' + d)
        .attr('x', (d, i) => x(i + domainStartFloor))
        .attr('y', y('sequence') + lh / 2)
        .attr('dominant-baseline', 'central')
        .style('text-anchor', 'middle');
    }

    const textColor = settings['text-color'];
    // Update the residue and dots color always
    residuesContainer.selectAll('text.residue').attr('fill', textColor);
    dotsContainer.selectAll('text.dot').attr('fill', textColor);
  }

  private createBrush() {
    this.initializeService.brushRegion = this.initializeService.draw.append('g').attr('class', 'brush');
  }

  private setSelectionShadow(selectionContext: SelectionContext) {
    const scale = this.initializeService.scale;
    const [start, end] = [selectionContext.range!.start, selectionContext.range!.end];

    this.initializeService.shadow
      .data([selectionContext])
      .attr('x', scale.x(start))
      .attr('width', scale.x(end) - scale.x(start))
  }

  private removeSelectionShadow() {
    this.initializeService.shadow
      .data([{trace : undefined, feature : undefined, range : undefined} as SelectionContext])
      .attr('x', 0)
      .attr('width', 0);
  }

  private setLabelsPosition(traces: InternalTraces) {
    const y = this.initializeService.scale.y;
    const {left : ml, right : mr} = this.initializeService.margin;
    const settings = this.initializeService.settings;

    for (const trace of traces) {
      // Get identifier trace
      const identifier = '' + trace.id;
      for (const place of ['left', 'right']) {
        // Get associated trace
        const label = this.initializeService.div.querySelector<HTMLDivElement>(`div#label-${place}-` + identifier);
        // If label exists, update its positioning
        if (label) {
          label.classList.add('label');
          if (place === 'left') {
            // Position the label to the left
            label.style.left = '0px';
            label.style.width = `${ml}px`;
          } else {
            // Position the label to the right, ad add a "margin" left of 8 px to space the label from the traces
            label.style.right = '0px';
            label.style.width = `${mr}px`;
          }
          label.style.top = y(identifier) + 'px';
          label.style.display = 'block';
          label.style.height = (trace.options?.['line-height'] || settings['line-height']) + 'px';
        }
      }
    }
  }

  private hideLabels(trace: InternalTrace) {
    // Get identifier trace
    const identifier = trace.id;
    for (const place of ['left', 'right']) {
      // Get associated trace
      const label = this.initializeService.div.querySelector<HTMLDivElement>(`div#label-${place}-` + identifier);
      // If label exists, update its positioning
      if (label) {
        // Hide label
        label.style.display = 'none';
      }
    }
  }

  private createGrid(traces: InternalTraces): void {
    const group = this.initializeService.focus
      // Create parent grid element
      .selectAll<SVGGElement, InternalTraces>('g.grid')
      .data<InternalTraces>([traces], index)
      .join('g')
      .attr('class', 'grid')
      .lower();

    this['group.grid'] = group
      .selectAll<SVGGElement | BaseType, InternalTrace>('g.grid-line-group')
      .data<InternalTrace>(traces, identity)
      .join('g')
      .attr('id', (d) => 'grid-' + d.id)
      .attr('class', 'grid-line-group')
      .join('line');

    this['group.grid'].each((trace) => {
      if (trace.options?.['grid']) {
        // In each group of grid lines, create the lines
        this['group.grid'].selectAll('line.grid-line')
          .data(trace.options?.['grid-y-values'] || [])
          .enter()
          .append('line')
          .attr('class', 'grid-line')
          .style('shape-rendering', 'crispedges')
          .attr('id', (d, index) => 'grid-line-' + index);
      }

      // Create initial zero-line if defined
      if (trace.options?.['zero-line']) {
        // Create zero line
        this['group.grid'].selectAll('line.zero-line')
          .data([true])
          .enter()
          .append('line')
          .attr('class', 'zero-line')
          .style('shape-rendering', 'crispedges')
          .attr('id', 'zero-line');
      }
    });
  }

  private updateGrid(): void {
    const group: GridLines = this['group.grid'];

    const y = this.initializeService.scale.y;
    const settings = this.initializeService.settings;
    const x1 = this.initializeService.x1;
    const x2 = this.initializeService.x2;

    group.each(function (trace: InternalTrace) {
      const traceGroup = d3.select(this);

      // Get all the necessary values to compute the position of the grid lines
      const mt = y('' + trace.id);
      const lh = trace.options?.['line-height'] || settings['line-height'];
      const cs = trace.options?.['content-size'] || settings['content-size'];

      // top is calculated as the distance to the top, plus the lh/2 to get the mid-point of the line, plus the cs/2 to get the bottom of the line
      const bottom = mt + lh / 2 + cs / 2;
      const top = mt + lh / 2 - cs / 2;

      function rescaleY(yValue: number): number {
        // top and bottom are actually switched, as the y-axis is inverted
        return bottom + (yValue - trace.domain.min) / (trace.domain.max - trace.domain.min) * (top - bottom);
      }

      // Update grid lines
      traceGroup
        .selectAll('line.grid-line')
        .data(trace.options?.grid ? trace.options?.['grid-y-values'] || [] : [])
        .attr('x1', x1)
        .attr('x2', x2)
        .attr('y1', d => rescaleY(d))
        .attr('y2', d => rescaleY(d))
        .attr('stroke', trace.options?.["grid-line-color"] || settings["grid-line-color"])
        .attr('stroke-width', trace.options?.["grid-line-width"] || 1);

      // Update zero-line if defined
      traceGroup
        .selectAll('line.zero-line')
        .data(trace.options?.['zero-line'] ? [true] : [])
        .attr('x1', x1)
        .attr('x2', x2)
        .attr('y1', rescaleY(0))
        .attr('y2', rescaleY(0))
        .attr('stroke', trace.options?.["zero-line-color"] || 'black')
        .attr('stroke-width', trace.options?.["zero-line-width"] || 1);
    });
  }

  private createTraces(traces: InternalTraces): void {
    // Get references to local variables as `this` might be lost
    const settings = this.initializeService.settings;
    const tooltipService = this.tooltipService;
    const initializeService = this.initializeService;
    const selectionEmitter$ = this.selectedFeatureEmit$;
    const scale = this.initializeService.scale;
    const circle = this.initializeService.hoverCircleMarker;

    // Generate and store traces groups
    this['group.traces'] = this.initializeService.draw
      .selectAll<SVGGElement | BaseType, InternalTrace>('g.trace')
      .data<InternalTrace>(traces, identity)
      .join('g')
      .attr('id', (trace) => 'trace-' + trace.id)
      .attr('class', 'trace');
    // .raise();
    // Iterate over each trace

    this['group.traces'].each(function (trace) {
      // Define trace group
      const traceGroup = d3.select(this);
      // Define feature groups
      const featureGroup = traceGroup
        .selectAll<d3.BaseType, Feature>('g.feature')
        .data(trace.features);
      // On: feature group enter
      featureGroup.enter().append('g')
        .attr('class', (d) => 'feature ' + d.type)
        .attr('id', (_, i) => `trace-${trace.id}-feature-${i}`)
        .each(function (feature, index) {
          // Define current selection
          const selection = d3.select(this);
          // Bind data to selection
          selection.data([feature]);
          // On mouse enter / over
          selection.on('mouseenter', (event: MouseEvent) => {
            tooltipService.onMouseEnter(event, trace, feature, index)
          });
          // On mouse move
          selection.on('mousemove', (event: MouseEvent) => {
            tooltipService.onMouseMove(event, trace, feature, index);

            // Get all the necessary values to compute the position of the grid lines
            const mt = scale.y('' + trace.id);
            const lh = trace.options?.['line-height'] || settings['line-height'];
            const cs = trace.options?.['content-size'] || settings['content-size'];

            // top is calculated as the distance to the top, plus the lh/2 to get the mid-point of the line, plus the cs/2 to get the bottom of the line
            const bottom = mt + lh / 2 + cs / 2;
            const top = mt + lh / 2 - cs / 2;

            function rescaleY(yValue: number): number {
              // top and bottom are actually switched, as the y-axis is inverted
              return bottom + (yValue - trace.domain.min) / (trace.domain.max - trace.domain.min) * (top - bottom);
            }

            if (feature.type == 'continuous') {
              const coordinates = initializeService.getCoordinates(event, trace.id);
              // Add a small circle to the feature to indicate the position of the mouse
              circle
                .attr('cx', scale.x(coordinates[0]))
                .attr('cy', rescaleY(feature.values[coordinates[0] - 1]))
                .attr('display', 'block')
            }
          });
          // On mouse leave
          selection.on('mouseleave', () => {
            tooltipService.onMouseLeave();
            circle.attr('display', 'none');
          });
          // On feature click
          selection.on('click', (event: MouseEvent) => selectFeature(feature, initializeService, event, trace, selectionEmitter$));

          const appendElementWithAttributes = (
            parent: d3.Selection<SVGGElement, unknown, null, undefined>,
            element: string,
            attributes: { [key: string]: number | string },
          ): d3.Selection<d3.BaseType, unknown, null, undefined> => {
            const el = parent.append(element);
            Object.entries(attributes).forEach(([key, value]) => {
              el.attr(key, value);
            });
            return el;
          };

          const container = d3.select(this);

          if (feature.type === 'locus') {
            const rectAttributes = {
              'stroke' : feature["stroke-color"] || 'none',
              'stroke-opacity' : 1.0,
              'stroke-width' : feature["stroke-width"] || 0,
              'fill' : feature.color || 'white',
              'fill-opacity' : feature.opacity || 1,
              'rx' : 4,
              'ry' : 4,
            };

            appendElementWithAttributes(container, 'rect', rectAttributes);

            // addMouseEvents(rect, tooltip, trace, feature);
            if (feature.label) {
              // Based on the color of the feature, determine if the fill of the text should be white or black
              let textColor = feature["text-color"] || settings["text-color"];

              if (!textColor) {
                const featureColor = d3.hsl(d3.color(feature.color || 'black')!);
                textColor = (Number.isNaN(featureColor.l) || featureColor.l > 0.5) ? "black" : "white";
              }

              const labelAttributes = {
                "dominant-baseline" : "central",
              }

              const text = appendElementWithAttributes(container, 'text', labelAttributes);
              text.text(feature.label)
              text.style("text-anchor", "left")
              // text.style("pinter-events", "none")
            }
          }

          if (feature.type === 'continuous') {
            const pathAttributes = {
              'stroke' : feature["stroke-color"] || feature.color || 'black',
              'stroke-opacity' : feature.opacity || 1,
              'stroke-width' : feature["stroke-width"] || 1,
              'fill' : feature.showArea ? feature.color || 'black' : 'none',
              'fill-opacity' : feature.opacity || 1,
            };

            appendElementWithAttributes(container, 'path', pathAttributes);
          }

          if (feature.type === 'pin') {
            const circleAttributes = {
              'stroke' : feature["stroke-color"] || 'none',
              'stroke-width' : feature["stroke-width"] || 0,
              'fill' : feature.color || 'black',
              'fill-opacity' : feature.opacity || 1,
            };
            appendElementWithAttributes(container, 'circle', circleAttributes);
          }

          if (feature.type === 'poly') {
            const polyAttributes = {
              'stroke' : feature["stroke-color"] || 'black',
              'stroke-opacity' : feature.opacity || 1,
              'stroke-width' : feature["stroke-width"] || 1,
              'fill' : feature.color || 'black',
              'fill-opacity' : feature.opacity || 1,
            };
            appendElementWithAttributes(container, 'polygon', polyAttributes);
          }

          if (feature.type === 'dssp') {
            const shapeToDraw = dsspShape(feature.code);

            if (shapeToDraw == "sheet") {
              const bSheetAttributes = {
                'class' : 'sheet',
                'stroke' : d3.color(feature.color || 'white')!.darker(.5).formatHex(),
                'stroke-width' : 2,
                'fill' : feature.color || 'white',
                'fill-opacity' : feature.opacity || 0.5,
              };
              appendElementWithAttributes(container, 'polygon', bSheetAttributes);
            }

            if (shapeToDraw == "coil") {
              const sw = Math.min(16, Math.max(3, (trace.options?.['content-size'] || settings['content-size']) / 8));
              const coilAttributes = {
                'class' : 'coil',
                'stroke' : feature.color || 'black',
                'stroke-opacity' : feature.opacity || .5,
                'stroke-width' : sw,
                'stroke-linecap' : 'square',
                'stroke-dasharray' : `${sw}, ${sw * 1.5}`,
                'fill' : 'none',
              };
              appendElementWithAttributes(container, 'path', coilAttributes);
            }
          }
        })
      // On: feature group removal
      featureGroup.exit().remove();
    });
  }

  private updateTraces(): void {
    const scale = this.initializeService.scale;
    const settings = this.initializeService.settings;
    const coilPoints = this.coilPoints;
    const charWidth = this.featureLabelCharWidth;

    this.initializeService.hoverCircleMarker.attr('display', 'none')

    // Loop through each trace
    this['group.traces'].each(function (trace) {
      // Select all trace groups
      const traceGroups = d3.select<d3.BaseType, InternalTraces>(this);
      // Select all feature groups
      const featureGroups = traceGroups.selectAll<d3.BaseType, Feature>('g.feature');
      // Loop through each feature group
      featureGroups.each(function (feature, featureIdx: number) {
        const {featureStart, featureEnd} = getStartEndPositions(feature);

        const currentDomainStart = scale.x.domain()[0];
        const currentDomainEnd = scale.x.domain()[1];

        // Calculate the starting point relative to the current domain (the shown part of the sequence)
        const startPoint = Math.max(featureStart, currentDomainStart);
        const endPoint = Math.min(featureEnd, currentDomainEnd);
        // If end is less than start, then the feature is not visible, so we skip it
        if (endPoint < startPoint) {
          if (alreadyExitedFromView.has(feature)) {
            // The feature was already not visible before and its position has already been updated outside the view
            return;
          } else {
            // The feature is not visible anymore, but we need to update its position to be outside the view
            alreadyExitedFromView.add(feature);
          }
        }
        // The feature is now visible, so we remove it from the set of features that are outside the view
        alreadyExitedFromView.delete(feature);

        // Get line height, content size
        const mt = scale.y('' + trace.id);
        const lh = trace.options?.['line-height'] || settings['line-height'];
        const cs = trace.options?.['content-size'] || settings['content-size'];
        const center = mt + lh / 2;
        const bottom = center + cs / 2;
        let top = center - cs / 2;

        function rescaleY(yValue: number): number {
          // top and bottom are actually switched, as the y-axis is inverted
          return bottom + (yValue - trace.domain.min) / (trace.domain.max - trace.domain.min) * (top - bottom);
        }

        function randomBetween(min: number, max: number): number {
          return Math.random() * (max - min) + min;
        }

        if (feature.type === 'locus') {
          // Define cell width
          const cw = scale.x(1) - scale.x(0);
          const featureWidth = scale.x(feature.end + .5) - scale.x(feature.start);

          if (feature.height) {
            top = top + (cs - feature.height) / 2;
          }
          // Select all rectangles (and bound data)
          d3.select<d3.BaseType, Locus>(this)
            .selectAll<d3.BaseType, Locus>('rect')
            // Set position
            .attr('x', (locus) => scale.x(locus.start - 0.5))
            .attr('y', top)
            // Set size
            .attr('height', feature.height !== undefined ? feature.height : cs)
            .attr('width', (locus) => {
              // Compute width
              return cw * (locus.end - locus.start + 1);
            })

          // If the feature is wide enough we can add the label of the feature as text inside of it
          if (feature.label) {
            const labelWidth = charWidth * feature.label.length;
            d3.select<d3.BaseType, Locus>(this)
              .selectAll<d3.BaseType, Locus>('text')
              .attr("x", scale.x(feature.start - 0.5) + 4)
              .attr('y', center)
              .attr("opacity", labelWidth + 8 < featureWidth ? 1 : 0)
              .attr('fill', feature["text-color"] || settings["text-color"])
          }
        }

        if (feature.type === 'continuous') {
          // Get values for feature
          const values = feature.values;
          // Initialize horizontal, vertical values
          const xy: [number, number][] = values.map((v: number, i: number) => [i + 1, v]);

          // Add another value at the start and end that is the same as the first and last value
          xy.unshift([0, xy[0][1]]);
          xy.push([values.length + .5, xy[xy.length - 1][1]]);

          let line: d3.Line<[number, number]> | d3.Area<[number, number]>;

          let curveType: d3.CurveFactory = d3.curveStep;

          // If curveType is defined, then use it
          if (feature.curveType) {
            curveType = d3[feature.curveType];
          }

          // If showArea is true, then the line should be an area
          if (feature.showArea) {
            line = d3.area<[number, number]>().curve(curveType)
              .x(([x]) => scale.x(x))
              .y1(([, y]) => rescaleY(y))
              .y0(bottom);
          } else {
            line = d3.line<[number, number]>().curve(curveType)
              .x(([x]) => scale.x(x))
              .y(([, y]) => rescaleY(y));
          }

          // Update path line
          d3.select<d3.BaseType, Continuous>(this)
            .select('path')
            .attr('d', line(xy));
        }

        if (feature.type === 'pin') {
          let radius;
          if (feature.adjustToWidth) {
            radius = Math.min(trace.options?.["content-size"] || settings["content-size"], (scale.x(1) - scale.x(0))) / 2;
          } else {
            radius = feature.radius || 8;
          }
          // Select all circles (and bound data)
          d3.select<d3.BaseType, Pin>(this)
            .selectAll<d3.BaseType, Pin>('circle')
            // Set position
            .attr('cx', (pin) => scale.x(pin.position))
            .attr('cy', center)
            .attr('r', radius);
        }

        if (feature.type === 'poly') {
          // Given the position of the feature and the radius, we can calculate the points of the polygon
          // that will be drawn inscribed in a circle with center at the position of the feature and radius equal to the radius of the feature
          const sides = feature.sides || 3;
          let radius;
          if (feature.adjustToWidth) {
            radius = Math.min(trace.options?.["content-size"] || settings["content-size"], (scale.x(1) - scale.x(0))) / 2;
          } else {
            radius = feature.radius || 8;
          }

          const angle = 2 * Math.PI / sides;
          const rotationAdjustment = Math.PI / 2 - Math.PI / sides;
          // Calculate the points remembering that the polygon should not be stretched in the x-y axis, but it is always of size radius*2
          const points = Array.from({length : sides}, (_, i) => {
            const x = radius * Math.cos(i * angle + rotationAdjustment);
            const y = radius * Math.sin(i * angle + rotationAdjustment);
            return [x + scale.x(feature.position), y + center];
          });
          d3.select<d3.BaseType, Pin>(this)
            .selectAll<d3.BaseType, Pin>('polygon')
            .attr('points', points.map(point => point.join(',')).join(' '));
        }

        if (feature.type === 'dssp') {
          const magicNumbers = {
            "helix" : {"bitWidth" : 0.25, "xScale" : 0.5, "yScale" : 0.119, "center" : -4},
            "turn" : {"bitWidth" : 0.8, "xScale" : 0.033, "yScale" : 0.035, "center" : +5.8},
            // Sheet is a special case as it is computed as a rectangle with a triangle on top at runtime
            "sheet" : {"bitWidth" : 4, "xScale" : 0, "yScale" : 0, "center" : 0},
            "coil" : {"bitWidth" : 0.3, "xScale" : 0, "yScale" : 0, "center" : 0},
          }

          const shapeToDraw = dsspShape(feature.code);
          const shapePath = DSSPPaths[shapeToDraw];

          const totalFeatureWidth = scale.x(endPoint) - scale.x(startPoint);
          const widthPerResidue = totalFeatureWidth / (endPoint - startPoint);

          // One helix every 100 points of width
          const bitWidth = cs * magicNumbers[shapeToDraw]["bitWidth"];
          const numBits = Math.floor(totalFeatureWidth / bitWidth + 1);
          const bitOccupancy = bitWidth / widthPerResidue;

          // Calculate the position in reverse order
          const xPositions = Array.from({length : numBits}, (_, i) => startPoint + i * bitOccupancy);

          if (xPositions.length < 2) {
            xPositions.push(endPoint);
          }

          const xScale = bitWidth * magicNumbers[shapeToDraw]["xScale"];
          const yScale = cs * magicNumbers[shapeToDraw]["yScale"];

          if (shapeToDraw == "helix" || shapeToDraw == "turn") {
            d3.select<d3.BaseType, DSSP>(this)
              .selectAll<d3.BaseType, number>('path')
              .data(xPositions)
              .join(
                enter => enter.append('path')
                  .attr("class", shapeToDraw)
                  .attr("d", shapePath)
                  .attr("stroke", d3.color(feature.color || 'white')!.darker(0.5).formatHex())
                  .attr("stroke-width", shapeToDraw == "helix" ? 0.1 : 0.7)
                  .attr("fill", feature.color || 'black')
                  .attr("transform-origin", "center center"),
                update => update,
                exit => exit.remove(),
              )
              .attr("fill-opacity", (_, i) => feature.opacity !== undefined ? (i % 2 == 0 ? feature.opacity - 0.2 : feature.opacity) : (i % 2 == 0 ? 0.5 : 0.7))
              .attr("transform", (xPosition, i) => {
                const flippedXScale = i % 2 == 0 ? xScale : -1 * xScale;
                return `translate(${scale.x(xPosition)}, ${center + magicNumbers[shapeToDraw]["center"]}) scale(${flippedXScale}, ${yScale})`
              });

            // Create a clip-path for each feature so to remove parts outside the range of the feature
            d3.select<d3.BaseType, DSSP>(this)
              .attr('clip-path', `url(#clip-path-${trace.id}-feature-${featureIdx})`)
              .selectAll(`#clip-path-${trace.id}-feature-${featureIdx}`)
              .data([feature])
              .join(
                enter => enter.append('defs')
                  .append('clipPath')
                  .attr('id', `clip-path-${trace.id}-feature-${featureIdx}`)
                  .append('rect')
                  .attr('width', totalFeatureWidth)
                  .attr('height', cs)
                  .attr('x', scale.x(startPoint))
                  .attr('y', top),
                update => update.select('rect')
                  .attr('width', totalFeatureWidth > 0 ? totalFeatureWidth : 0)
                  .attr('height', cs)
                  .attr('x', scale.x(startPoint))
                  .attr('y', top),
                exit => exit.remove(),
              );
          }

          if (shapeToDraw == "sheet") {
            // In the case of the sheet, we just want to draw an arrow, where the body is a rectangle, and the head is a triangle
            const arrowWidth = cs / 2;
            const sheetWidth = totalFeatureWidth - arrowWidth;
            const sheetHeight = cs / 2;
            const sheetX = scale.x(startPoint);
            const sheetY = center - sheetHeight / 2;

            const arrowHeight = cs;
            const arrowX = scale.x(endPoint) - arrowWidth;
            const arrowY = center - arrowHeight / 2;

            // Define points for the polygon representing the arrow
            const points = [
              [sheetX, sheetY], // Top-left corner of the rectangle
              [sheetX + sheetWidth, sheetY], // Top-right corner of the rectangle
              [sheetX + sheetWidth, arrowY], // Transition from rectangle to arrowhead
              [arrowX + arrowWidth, arrowY + arrowHeight / 2], // Tip of the arrowhead
              [sheetX + sheetWidth, arrowY + arrowHeight], // Bottom of the arrowhead
              [sheetX + sheetWidth, sheetY + sheetHeight], // Bottom-right corner of the rectangle
              [sheetX, sheetY + sheetHeight], // Bottom-left corner of the rectangle
            ];

            // Join points into a string for the `points` attribute
            const pointsString = points.map(point => point.join(",")).join(" ");

            d3.select<d3.BaseType, DSSP>(this)
              .selectAll<d3.BaseType, number>('polygon')
              .attr("points", pointsString);
          }

          if (shapeToDraw == "coil") {
            const featureKey = `${trace.id}-feature-${featureIdx}`;

            if (!coilPoints.has(featureKey)) {
              coilPoints.set(featureKey, []);
            }

            const line = d3.line<[number, number]>().curve(d3.curveBasis)
              .x(([x]) => scale.x(x))
              .y(([, y]) => rescaleY(y));

            d3.select<d3.BaseType, DSSP>(this)
              .selectAll<d3.BaseType, [number, number][]>('path')
              .attr("d", () => {
                const yValues = coilPoints.get(featureKey)!;
                const totalXPoints = xPositions.length + 1
                // If the number of points is less than the number of x positions, add random values at the end
                for (let i = yValues.length ; i < totalXPoints ; i++) {
                  const y = randomBetween(trace.domain.min, trace.domain.max);
                  // Put the value in the second to last position
                  yValues.splice(yValues.length - 1, 0, y);
                }
                // If the number of points is greater than the number of x positions, remove the last values
                for (let i = yValues.length - 1 ; i >= totalXPoints ; i--) {
                  // Remove the value in the second to last position
                  yValues.splice(i, 1);
                }
                // The first and last points should be in the middle of the domain
                yValues[0] = (trace.domain.max + trace.domain.min) / 2;
                yValues[yValues.length - 1] = (trace.domain.max + trace.domain.min) / 2;

                // Update the current yValues to reuse them in the next iteration
                coilPoints.set(featureKey, yValues);

                // Create the xyPoints array
                const xyPoints: [number, number][] = xPositions.map((x, i) => [x, yValues[i]]);
                // Add last point to make it touch the middle of the domain
                xyPoints.push([endPoint, yValues[yValues.length - 1]]);

                return line(xyPoints)
              });
          }
        }
      });
    });
  }

  private updateShadowPosition() {
    const shadow = this.initializeService.shadow;
    const scale = this.initializeService.scale;

    const selectionContext = shadow.datum();

    if (selectionContext.range) {
      // Get the feature associated with the shadow
      const selectionContext = shadow.datum();
      // Update the position of the shadow
      shadow
        .attr('x', scale.x(selectionContext.range!.start))
        .attr('width', scale.x(selectionContext.range!.end) - scale.x(selectionContext.range!.start));
    }
  }

  public onLabelClick(trace: InternalTrace): void {
    // Update flag for current trace
    trace.expanded = !trace.expanded;
    const descendantsTracesIds = this.featuresService.getBranch(trace).slice(1);

    for (const descendant of descendantsTracesIds) {
      // If the trace is expanded, then only the next level of traces should be shown
      if (trace.expanded) {
        if (descendant.level === trace.level + 1) {
          descendant.show = true;
        }
      } else {
        descendant.show = false;
      }
      descendant.expanded = false;
    }

    // Emit current traces
    this.traces$.next(this.featuresService.tracesNoNesting$.value.filter(trace => trace.show));
  }
}

function parseSequence(sequence: Sequence): string[] {
  const residues: string[] = [];
  // Case sequence is an array
  if (Array.isArray(sequence)) {
    // Update residues list
    residues.push(...sequence);
  }
  // Case sequence is a string
  else if (typeof sequence === 'string') {
    // Update residues list
    residues.push(...sequence.split(''));
  }
  return residues;
}

function getStartEndPositions(feature: Feature) {
  let featureStart, featureEnd;
  switch (feature.type) {
    case 'locus':
      featureStart = feature.start - 0.5;
      featureEnd = feature.end + 0.5;
      break;
    case 'dssp':
      featureStart = feature.start - 0.5;
      featureEnd = feature.end + 0.5;
      break;
    case 'continuous':
      featureStart = 0.5;
      featureEnd = feature.values.length + 0.5;
      break;
    case 'pin':
      featureStart = feature.position - 0.5;
      featureEnd = feature.position + 0.5;
      break;
    case 'poly':
      featureStart = feature.position - 0.5;
      featureEnd = feature.position + 0.5;
      break;
    default:
      featureStart = 0;
      featureEnd = 10;
  }
  return {featureStart, featureEnd};
}

function selectFeature(feature: Feature, initializeService: InitializeService, event: MouseEvent, trace: InternalTrace, selectionEmitter$: EventEmitter<SelectionContext | undefined>) {
  let {featureStart, featureEnd} = getStartEndPositions(feature);

  const coordinates = initializeService.getCoordinates(event, trace.id);
  if (feature.type === 'continuous') {
    featureStart = coordinates[0] - 0.5;
    featureEnd = coordinates[0] + 0.5;
  }
  const selectionContext: SelectionContext = {
    trace,
    feature,
    range : {start : featureStart, end : featureEnd},
  }
  selectionEmitter$.next(selectionContext);
}
