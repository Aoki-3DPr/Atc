#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll x, a, b; cin >> x >> a >> b;
	if (abs(a - x) > abs(b - x)) {
		cout << "B";
	} else {
		cout << "A";
	}
	return 0;
}

int main() {
	solve();
    return 0;
}
