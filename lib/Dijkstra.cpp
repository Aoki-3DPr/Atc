#pragma once
#include <iostream>
#include <vector>
using namespace std;
#define ll long long

class Dijkstra {
private:
	int n;
	int Div;
	vector<int> v;
	void vectorFactorial() {
		v[0] = 1;
		for (ll i = 1; i <= n; i++) {
			v[i] = (v[i - 1] * i) % Div;
		}
	}
public:
	Dijkstra(int n, int Mod) {

	}
};


#ifdef BUILDING_LIB_STANDALONE
int main() {
	return 0;

}
#endif
