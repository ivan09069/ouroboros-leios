import {
  useSimContext
} from "@/contexts/SimContext/context";
import { useCallback } from "react";

export const useHandlers = () => {
  const {
    state: {
      aggregatedData,
      graph: {
        canvasOffsetX,
        canvasOffsetY,
        canvasRef,
        canvasScale,
        currentNode,
      },
      maxTime,
      topography,
    },
  } = useSimContext();

  const drawTopography = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context || !canvas) {
      return;
    }

    // Set canvas dimensions
    const width = canvas.parentElement?.getBoundingClientRect().width || 1024;
    const height = canvas.parentElement?.getBoundingClientRect().height || 800;
    canvas.width = width;
    canvas.height = height;

    // Clear the canvas
    context.clearRect(0, 0, width, height);
    context.save();

    // Apply translation and scaling
    context.translate(canvasOffsetX, canvasOffsetY);
    context.scale(canvasScale, canvasScale);

    // Draw the links
    topography.links.forEach((link) => {
      const nodeStart = topography.nodes.get(link.source);
      const nodeEnd = topography.nodes.get(link.target);
      if (!nodeStart || !nodeEnd) {
        return;
      }

      context.beginPath();
      context.moveTo(nodeStart.fx, nodeStart.fy);
      context.lineTo(nodeEnd.fx, nodeEnd.fy);
      context.strokeStyle = "#ddd";

      if (link.source === currentNode || link.target === currentNode) {
        context.strokeStyle = "black";
      }

      context.lineWidth = Math.min((0.2 / canvasScale) * 6, 0.2);
      context.stroke();
    });

    // Draw the nodes
    topography.nodes.forEach((node) => {
      context.beginPath();
      context.arc(
        node.fx,
        node.fy,
        Math.min((1 / canvasScale) * 6, 1),
        0,
        2 * Math.PI,
      );
      context.fillStyle = node.data.stake ? "#DC53DE" : "blue";
      context.stroke();
      context.lineWidth = Math.min((0.5 / canvasScale) * 6, 0.5);

      if (aggregatedData.lastNodesUpdated.includes(node.id.toString())) {
        context.strokeStyle = "red";
      } else {
        context.strokeStyle = "black";
      }

      if (currentNode === node.id.toString()) {
        context.fillStyle = "blue";
      } else if (!node.data.stake) {
        context.fillStyle = "gray"
      }

      context.fill();
    });

    context.restore();
  }, [
    aggregatedData,
    maxTime,
    topography.nodes,
    topography.links,
    currentNode,
    canvasOffsetX,
    canvasOffsetY,
    canvasScale,
  ]);

  return {
    drawTopography,
  };
};
