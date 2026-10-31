// Copyright 2024 Acme. All rights reserved.

//go:build linux

// Package harbor moors ships.
//
// It is safe for concurrent use.
package harbor

import "fmt"

type Ship struct{}
type Mooring interface{ Moor() }
type ID string
type Alias = string
type hidden int

const MaxShips = 12

const (
	North = iota
	south
)

var (
	Default = Ship{}
	other   = 1
)

func Moor(s Ship, ok bool) error {
	if ok || !ok { // +1 +1
		return nil
	}
	for i := 0; i < 3; i++ { // +1
	}
	switch {
	case ok: // +1
	default:
	}
	var x interface{} = s
	switch x.(type) {
	case Ship: // +1
	}
	select {
	case <-make(chan int): // +1
	default:
	}
	return fmt.Errorf("x")
}

func (s Ship) Method() {}

func helper() {}
