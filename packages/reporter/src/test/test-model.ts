import _ from 'lodash'
import { action, autorun, computed, observable, observe } from 'mobx'

import Err from '../errors/err-model'
import Hook from '../hooks/hook-model'
import Runnable, { RunnableProps } from '../runnables/runnable-model'
import Command, { CommandProps } from '../commands/command-model'
import Agent, { AgentProps } from '../agents/agent-model'
import Route, { RouteProps } from '../routes/route-model'

export type TestState = 'active' | 'failed' | 'pending' | 'passed' | 'processing'

export type UpdateTestCallback = () => void

export interface TestProps extends RunnableProps {
  state: TestState
  err?: Err
  isOpen?: boolean
  agents?: Array<AgentProps>
  commands?: Array<CommandProps>
  routes?: Array<RouteProps>
}

export interface UpdatableTestProps {
  state?: TestProps['state']
  err?: TestProps['err']
  hookName?: string
  isOpen?: TestProps['isOpen']
}

export default class Test extends Runnable {
  @observable agents: Array<Agent> = []
  @observable commands: Array<Command> = []
  @observable err = new Err({})
  @observable hooks: Array<Hook> = []
  // TODO: make this an enum with states: 'QUEUED, ACTIVE, INACTIVE'
  @observable isActive: boolean | null = null
  @observable isLongRunning = false
  @observable isOpen = false
  @observable routes: Array<Route> = []
  @observable _state?: TestState | null = null
  type = 'test'

  callbackAfterUpdate: (() => void) | null = null

  constructor (props: TestProps, level: number) {
    super(props, level)

    this._state = props.state
    this.err.update(props.err)

    autorun(() => {
      // if at any point, a command goes long running, set isLongRunning
      // to true until the test becomes inactive
      if (!this.isActive) {
        action('became:inactive', () => {
          return this.isLongRunning = false
        })()
      } else if (this._hasLongRunningCommand) {
        action('became:long:running', () => {
          return this.isLongRunning = true
        })()
      }
    })
  }

  @computed get _hasLongRunningCommand () {
    return _.some(this.commands, (command) => {
      return command.isLongRunning
    })
  }

  @computed get state () {
    return this._state || (this.isActive ? 'active' : 'processing')
  }

  addAgent (agent: Agent) {
    this.agents.push(agent)
  }

  addRoute (route: Route) {
    this.routes.push(route)
  }

  addCommand (command: Command, hookName: string) {
    const hook = this._findOrCreateHook(hookName)

    this.commands.push(command)
    hook.addCommand(command)
  }

  start () {
    this.isActive = true
  }

  update ({ state, err, hookName, isOpen }: UpdatableTestProps, cb?: UpdateTestCallback) {
    let hadChanges = false

    const disposer = observe(this, (change) => {
      hadChanges = true

      disposer()

      // apply change as-is
      return change
    })

    if (cb) {
      this.callbackAfterUpdate = () => {
        this.callbackAfterUpdate = null
        cb()
      }
    }

    this._state = state
    this.err.update(err)
    if (isOpen != null) {
      this.isOpen = isOpen
    }

    if (hookName) {
      const hook = _.find(this.hooks, { name: hookName })

      if (hook) {
        hook.failed = true
      }
    }

    // if we had no changes then react will
    // never fire componentDidUpdate and
    // so we need to manually call our callback
    // https://github.com/cypress-io/cypress/issues/674#issuecomment-366495057
    if (!hadChanges) {
      // unbind the listener if no changes
      disposer()

      // if we had a callback, invoke it
      if (this.callbackAfterUpdate) {
        this.callbackAfterUpdate()
      }
    }
  }

  finish (props: UpdatableTestProps) {
    this.update(props)
    this.isActive = false
  }

  commandMatchingErr () {
    return _(this.hooks)
    .map((hook) => {
      return hook.commandMatchingErr(this.err)
    })
    .compact()
    .last()
  }

  _findOrCreateHook (name: string) {
    const hook = _.find(this.hooks, { name })

    if (hook) return hook

    const newHook = new Hook({ name })

    this.hooks.push(newHook)

    return newHook
  }
}
