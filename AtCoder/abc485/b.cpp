#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, m; cin >> n >> m;
	vector<string> v(n);
	for (ll i = 0; i < n; i++) {
		cin >> v[i];
	}
	ll count = 0;
	ll index = 0;
	for (ll i = 0; i < n; i++) {
		if (v[i][0] == 'x') {
			index = i;
			count++;
		}
	}
	if (count == 1) {
		cout << "Faucet " << index + 1;
		return 0;
	}
	count = 0;
	index = 0;
	for (ll i = 0; i < m; i++) {
		if (v[0][i] == 'x') {
			index = i;
			count++;
		}
	}
	if (count == 1) {
		cout << "Drain " << index + 1;
		return 0;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

