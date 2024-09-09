<script setup lang="ts">
import { computed } from 'vue';
import type { Node, Edge } from '@vue-flow/core';
import { VueFlow } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import dagre from '@dagrejs/dagre';
import AxialLead from '@/components/common/AxialLead.vue';

import { getColorCodes, type Combination, type CombinationNode } from '@/lib/passiveComponent';
import type { ApproxResult } from './constants';
import { SIValue } from '@nanase/alnilam/siPrefix';

const { result, combination } = defineProps<{
  result: ApproxResult;
  combination: Combination;
}>();

const position = { x: 0, y: 0 };
const terminalSize = { width: 7.5, height: 7.5, borderWidth: 3 };
const junctionSize = { width: 2.5, height: 2.5, borderWidth: 0 };
const componentSize = { width: 70, height: 20, borderWidth: 1 };
const seriesPadding = 25;
const parallelPadding = 5;
const terminalPadding = 15;

function generateGraph(node: CombinationNode): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [{ id: 'S', type: 'start', position }];
  const edges: Edge[] = [];
  let nodeIdCounter = 0;

  function traverse(currentNode: CombinationNode, parentIds: string[]): string[] {
    if (currentNode.type === 'term') {
      const nodeId = (nodeIdCounter++).toString();
      nodes.push({
        id: nodeId,
        type: 'component',
        data: {
          value: currentNode.children,
          label: `${SIValue.fit(currentNode.children, result.componentType.prefixSymbols).toSimpleString(3)}${result.componentType.unit}`,
        },
        position,
      });
      for (const parentId of parentIds) {
        edges.push({
          id: `e${parentId}-${nodeId}`,
          source: parentId,
          target: nodeId,
        });
      }
      return [nodeId];
    } else if (currentNode.type === 'series') {
      let lastNodeIds = parentIds;
      currentNode.children.forEach((child) => {
        const nodeIds = traverse(child, lastNodeIds);

        if (lastNodeIds.length > 1 && nodeIds.length > 1) {
          const junctionFromNodeIds = lastNodeIds;
          const junctionToNodeIds = new Set(
            junctionFromNodeIds.flatMap((f) => edges.filter((e) => e.source === f).map((e) => e.target)),
          );

          const junctionNodeId = `j${nodeIdCounter++}`;
          nodes.push({
            id: junctionNodeId,
            type: 'junction',
            position,
          });

          // delete old edges
          for (const fromId of lastNodeIds) {
            for (const toId of junctionToNodeIds) {
              edges.splice(
                edges.findIndex((e) => e.source === fromId && e.target === toId),
                1,
              );
            }
          }

          // create new edges
          for (const parentId of lastNodeIds) {
            edges.push({
              id: `e${parentId}-${junctionNodeId}`,
              source: parentId,
              target: junctionNodeId,
            });
          }
          for (const parentId of junctionToNodeIds) {
            edges.push({
              id: `e${junctionNodeId}-${parentId}`,
              source: junctionNodeId,
              target: parentId,
            });
          }
        }

        lastNodeIds = nodeIds;
        return nodeIds;
      });
      return lastNodeIds;
    } else if (currentNode.type === 'parallel') {
      return currentNode.children.flatMap((child) => traverse(child, parentIds));
    }
    return [];
  }

  const endNodes = traverse(node, ['S']);
  endNodes.forEach((nodeId) => {
    edges.push({
      id: `e${nodeId}-E`,
      source: nodeId,
      target: 'E',
    });
  });

  nodes.push({ id: 'E', type: 'end', position });

  return { nodes, edges };
}

const combinationGraphData = computed(() => generateGraph(combination.nodes));
const nodes = computed<Node[]>(() => {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    nodesep: parallelPadding,
    ranksep: seriesPadding,
  });

  for (const node of combinationGraphData.value.nodes) {
    switch (node.type) {
      case 'start':
      case 'end':
      case 'junction': {
        graph.setNode(node.id, {
          width: terminalSize.width + terminalPadding,
          height: terminalSize.height,
        });
        break;
      }

      case 'component': {
        graph.setNode(node.id, {
          label: node.data.label,
          width: componentSize.width,
          height: componentSize.height,
        });
        break;
      }
    }
  }

  for (const edge of combinationGraphData.value.edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return combinationGraphData.value.nodes.map((node) => {
    const nodeWithPosition = graph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWithPosition.width / 2 + (node.type === 'component' ? 0 : terminalPadding / 2),
        y: nodeWithPosition.y - nodeWithPosition.height / 2,
      },
    };
  });
});
</script>

<template>
  <v-dialog style="max-width: 600px">
    <template #activator="{ props }">
      <slot name="activator" :props></slot>
    </template>
    <template #default="{ isActive }">
      <v-card>
        <v-card-text style="height: 150px">
          <VueFlow
            :nodes
            :edges="combinationGraphData.edges"
            :nodes-draggable="false"
            :nodes-connectable="false"
            fit-view-on-init
          >
            <template #node-start>
              <div
                class="node-terminal"
                :style="{
                  width: terminalSize.width + 'px',
                  height: terminalSize.height + 'px',
                  borderWidth: terminalSize.borderWidth + 'px',
                }"
              ></div>
              <Handle class="no-handle" type="source" :position="Position.Right" />
            </template>
            <template #node-end>
              <div
                class="node-terminal"
                :style="{
                  width: terminalSize.width + 'px',
                  height: terminalSize.height + 'px',
                  borderWidth: terminalSize.borderWidth + 'px',
                }"
              ></div>
              <Handle class="no-handle" type="target" :position="Position.Left" />
            </template>
            <template #node-junction>
              <div
                class="node-junction"
                :style="{
                  width: junctionSize.width + 'px',
                  height: junctionSize.height + 'px',
                  borderWidth: junctionSize.borderWidth + 'px',
                }"
              ></div>
              <Handle class="no-handle" type="target" :position="Position.Left" />
              <Handle class="no-handle" type="source" :position="Position.Right" />
            </template>
            <template #node-component="{ data }">
              <AxialLead
                v-if="result.componentType.value === 'resistor'"
                :text="data.label"
                color="#fbddc9"
                barsAlign="right"
                :colorCodes="getColorCodes(data.value, 5, '4-band')"
                :barWidth="4"
                :separatorWidth="1"
                style="color: black; width: 70px; height: 15px; font-size: 50%; margin: 2px; padding: 0 5px"
              />
              <AxialLead
                v-else-if="result.componentType.value === 'capacitor'"
                :text="data.label"
                color="#111111"
                style="color: white; width: 70px; height: 15px; font-size: 50%; margin: 2px; padding: 0 5px"
              />
              <AxialLead
                v-else-if="result.componentType.value === 'inductor'"
                :text="data.label"
                color="#68b697"
                barsAlign="right"
                :colorCodes="getColorCodes(data.value * 1e6, 10, '4-band')"
                :barWidth="4"
                :separatorWidth="1"
                style="color: black; width: 70px; height: 15px; font-size: 50%; margin: 2px; padding: 0 5px"
              />
              <Handle class="no-handle" type="target" :position="Position.Left" />
              <Handle class="no-handle" type="source" :position="Position.Right" />
            </template>
          </VueFlow>
        </v-card-text>
        <v-card-text> 組み合わせ式: {{ combination.toString(result.componentType.prefixSymbols) }} </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text="閉じる" @click="isActive.value = false"></v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-dialog>
</template>

<style lang="scss" scoped>
.no-handle {
  border: none;
  height: unset;
  width: unset;
  background: transparent;
}

.node-terminal {
  border: double #fff;
  border-radius: 50px;
  background-color: #888;
}

.node-junction {
  border: solid #888;
  border-radius: 50px;
  background-color: #888;
}

.node-component {
  border: solid black;
  border-radius: 10px;
  background-color: #fbddc9;
  color: black;
  font-size: 10px;
  padding-left: 5px;
  line-height: 200%;
}
</style>
