"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import ErrorState from "./ErrorState";
import { sendClientErrorReport } from "@/components/ClientErrorReporter";

type Props = { children: ReactNode; resetKey?: string; onRetry?: () => void };
type State = { failed: boolean };

/** Widget-level boundary. Server-render failures are handled by Next's route boundary. */
export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    sendClientErrorReport(error, "react-error-boundary");
  }
  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  private retry = () => {
    this.setState({ failed: false });
    this.props.onRetry?.();
  };
  render() {
    if (this.state.failed) return <ErrorState description="Цей блок тимчасово недоступний. Решта сторінки продовжує працювати."
      actions={<Button onClick={this.retry}>Повторити</Button>} />;
    return this.props.children;
  }
}
