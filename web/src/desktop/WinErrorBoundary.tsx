import { Component, createRef, type ReactNode } from 'react';

/**
 * One window can never kill the desk. A throw inside a single window body is
 * caught here — the window shows a titled fallback with a way back, and every
 * other window keeps working.
 */
export class WinErrorBoundary extends Component<
  { title: string; onClose: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(_p: unknown, prev: { failed: boolean }) {
    if (this.state.failed && !prev.failed) this.heading.current?.focus();
  }

  private retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="pad" role="alert">
        <h3 ref={this.heading} tabIndex={-1}>This view stopped working</h3>
        <p className="muted">{this.props.title} hit a rendering problem. Nothing else on the desk is affected.</p>
        <p>
          <button onClick={this.retry}>Reload this window</button>{' '}
          <button onClick={this.props.onClose}>Close</button>
        </p>
      </div>
    );
  }
}
