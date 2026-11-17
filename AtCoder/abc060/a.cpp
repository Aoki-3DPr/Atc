#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	vector<string> v(3);
	for (ll i = 0 ; i < 3 ; i++) {
		cin >> v[i];

	}
	if (v[0][v[0].length() - 1] == v[1][0] && v[1][v[1].length() - 1] == v[2][0]) {
		cout << "YES" << endl;
	} else {
		cout << "NO" << endl;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

